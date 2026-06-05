## Context

현재 운영 환경은 AWS `ap-northeast-2`의 EC2 `study-note-mvp-node` 단일 노드에 구성되어 있다. 서버는 Ubuntu 22.04, `t3.small`, 30GiB gp3 root volume, Elastic IP `3.39.3.103`을 사용하며, k3s 단일 control-plane 위에 Argo CD, cert-manager, k3s 번들 Traefik, infinite-buying frontend/backend가 올라가 있다.

현재 확인한 EC2 메모리는 총 1.9GiB이고, 사용량은 약 1.4GiB, available은 약 248MiB, swap 2.0GiB 중 약 758MiB가 사용 중이다. Kubernetes node 기준 메모리 사용률도 약 79%다. Ampere A1 Always Free 최대치인 **4 OCPU / 24GB RAM** shape을 사용한다(무료 한도 안에서 최대 자원을 선점). 현재 EC2(1.9GiB)보다 메모리가 10배 이상 넉넉하므로 k3s + Argo CD + cert-manager + Traefik 구조를 그대로 옮겨도 메모리 압박은 오히려 줄어든다.

현재 GitOps 흐름은 GitHub Actions가 `main` merge 시 AWS ECR에 backend/frontend 이미지를 push하고, `infra/kubernetes/infinite-buying/overlays/mvp/kustomization.yaml`의 image tag를 commit하면 Argo CD가 EC2 k3s에서 자동 sync하는 구조다. 이번 이전에서도 이 GitOps 흐름을 그대로 유지하고, 이미지 레지스트리만 OCIR로 바꾼다.

backend 데이터는 Kubernetes PVC가 아니라 node hostPath `/var/lib/infinite-buying/backend`에 저장된다(`backend-deployment.yaml`의 `hostPath` 볼륨, `type: DirectoryOrCreate`). 실제 SQLite DB는 `/var/lib/infinite-buying/backend/app.db`이고 현재 크기는 약 7.1MB다. 이 앱은 KIS credential과 자동매매 이력을 저장하므로 DB와 `infinite-buying-secrets`(특히 `SECRET_ENCRYPTION_KEY`)를 함께 유지해야 한다.

현재 ECR 인증은 토큰이 짧게 만료되므로 `ecr-secret-refresh` CronJob이 6시간마다 `ecr-registry` dockerconfigjson Secret을 갱신하고, backend/frontend Deployment가 이를 `imagePullSecrets`로 참조한다. OCIR로 옮기면 이 만료 갱신 구조가 불필요해진다.

Route53 hosted zone `yuna-pa.com`은 유지한다. 현재 `infinite-buying.yuna-pa.com`은 A record로 `3.39.3.103`을 가리키고, `www.infinite-buying.yuna-pa.com`은 CNAME으로 apex subdomain을 가리킨다.

OCI CLI 인증은 확인됐다. 마이그레이션 적용 단계에서는 현재 설정된 OCI 리전, compartment, availability domain을 조회한 뒤 대상 값을 확정한다. 현재 대상 compartment에는 재사용할 Compute instance와 VCN이 없을 수 있으므로, Oracle 이전은 VCN부터 새로 만드는 bootstrap 작업을 포함해야 한다. 조회된 quota는 참고값일 뿐이고, 실제 Always Free capacity 확보 여부는 instance 생성 시점에 최종 확인한다.

## Goals / Non-Goals

**Goals:**

- AWS EC2 단일 노드 k3s/Argo CD 운영 환경을 Oracle Ampere A1(ARM64) 단일 노드 k3s 환경으로 리프트앤시프트한다.
- GitHub merge 후 Argo CD GitOps로 자동 배포되는 흐름을 그대로 유지한다.
- AWS ECR 의존성을 OCIR로 교체하고, ECR refresh CronJob 의존을 제거한다.
- Oracle Ampere A1 ARM 환경에서 동작하도록 ARM64(또는 multi-arch) 이미지를 빌드한다.
- 기존 Kubernetes manifest(base/overlay)를 최대한 그대로 재사용한다.
- SQLite DB, 운영 secrets, TLS, DNS 전환을 포함한 안전한 이전 절차를 정의한다.
- Oracle 정상 운영 확인 전까지 AWS EC2를 rollback 대상으로 유지한다.
- Oracle 전환 후 AWS EC2, EBS, Elastic IP, ECR repository, 불필요한 VPC 리소스를 정리할 수 있게 한다.

**Non-Goals:**

- 애플리케이션 기능, 자동매매 알고리즘, KIS API 연동 로직을 변경하지 않는다.
- SQLite를 PostgreSQL 등 외부 DB로 전환하지 않는다.
- backend scheduler를 다중 replica 안전 구조로 바꾸지 않는다.
- k3s 다중 노드 HA 또는 복제 스토리지(Longhorn 등)를 구성하지 않는다. backend는 단일 replica·단일 노드 SQLite writer로 유지하므로 노드 장애 시 무중단 HA는 이번 범위가 아니다.
- Docker Compose, SSH direct deploy 등 GitOps를 대체하는 배포 방식으로 바꾸지 않는다.
- Route53 hosted zone을 Oracle DNS로 이전하지 않는다.

## Decisions

### Decision: 운영 아키텍처는 단일 노드 k3s + Argo CD로 유지한다

A1 Always Free가 최대 24GiB라 현재 EC2(1.9GiB)보다 메모리가 넉넉하므로, k3s/Argo CD를 버릴 메모리상 이유가 없다. 기존 manifest와 GitOps self-heal, 학습된 운영 절차를 그대로 보존하는 리프트앤시프트가 새 런타임(Docker Compose 등)을 작성·검증하는 것보다 위험이 작다.

A1 노드에 다음을 설치한다(현재 EC2와 동일 구성).

- k3s 단일 server 노드(번들 Traefik, ServiceLB 사용)
- Argo CD
- cert-manager (`letsencrypt-prod` ClusterIssuer)
- `infinite-buying` 네임스페이스의 backend/frontend Deployment, Service, Ingress

backend는 SQLite 단일 writer + scheduler이므로 replica는 1개로 유지한다. 노드 장애 시 무중단을 위한 다중 노드 HA·복제 스토리지는 구성하지 않는다(단일 노드 SPOF는 현재 EC2와 동일 수준으로 수용하고, rollback용 EC2로 위험을 흡수한다).

### Decision: 자동 배포는 Argo CD GitOps로 유지한다

이미지 레지스트리만 바뀌므로 GitOps 흐름을 바꿀 이유가 없다. GitHub Actions는 다음 순서로 동작한다(현재와 동일, 레지스트리만 OCIR).

1. `main` merge 감지
2. backend/frontend ARM64 이미지 build (buildx + QEMU 또는 ARM runner)
3. OCIR push
4. `overlays/mvp/kustomization.yaml`의 image newName(OCIR)·newTag(sha) commit
5. Argo CD가 A1 k3s에서 자동 sync

self-heal, drift 감지, rollback(이전 commit으로 revert) 등 기존 GitOps 운영 이점을 그대로 쓴다.

### Decision: image registry는 OCIR로 고정하고 ECR refresh를 제거한다

ECR는 토큰이 짧게 만료되어 `ecr-secret-refresh` CronJob(`0 */6 * * *`)과 `ecr-refresher` RBAC, `ecr-registry` Secret을 유지해야 한다. OCIR로 옮기면 이 만료 갱신 구조가 사라진다.

- OCIR repository를 public pull 가능하게 두면 cluster에 pull secret이 필요 없다 → backend/frontend Deployment의 `imagePullSecrets`를 제거한다.
- private repository로 두면 OCIR auth token 기반 dockerconfigjson Secret을 주입하고 `imagePullSecrets`로 참조한다. ECR의 6시간 갱신 CronJob은 불필요하다.

이미지 좌표는 다음으로 고정한다.

- `yny.ocir.io/axnyuujz40an/infinite-buying-backend:<sha>`
- `yny.ocir.io/axnyuujz40an/infinite-buying-frontend:<sha>`

`ecr-refresh-cronjob.yaml`, `ecr-refresh-rbac.yaml`을 base kustomization에서 제거한다.

### Decision: 이미지는 ARM64로 빌드한다

A1은 ARM64(aarch64)다. 현재 워크플로의 `docker build`는 GH 호스트 runner의 amd64로 빌드하므로 A1에서 실행되지 않는다.

- `docker/setup-qemu-action` + `docker/setup-buildx-action`으로 `--platform linux/arm64` 빌드를 수행하거나, multi-arch(`linux/amd64,linux/arm64`) manifest를 push한다.
- backend Dockerfile은 `apk add python3 make g++`로 네이티브 모듈(better-sqlite3)을 빌드하므로 ARM64에서도 컴파일 가능하다. QEMU 에뮬레이션 빌드는 느릴 수 있으니, 필요하면 ARM runner 사용을 검토한다.
- A1에서 pull/run smoke test를 먼저 수행해 아키텍처 호환을 확인한 뒤 DNS를 전환한다.

### Decision: OCI bootstrap은 새 VCN부터 생성한다

현재 대상 compartment에는 재사용할 VCN과 instance가 없을 수 있다. 따라서 migration apply 단계는 기존 네트워크를 재사용하지 않고 다음 리소스를 새로 만든다.

- VCN
- public subnet
- internet gateway
- route table (`0.0.0.0/0` → internet gateway)
- security list 또는 NSG
- reserved public IP 또는 instance public IP
- Ampere A1 Compute instance (ARM64, Ubuntu, 4 OCPU / 24GB RAM)

보안 규칙은 80/443을 공개하고(cert-manager HTTP-01 + 서비스 트래픽), SSH(22)는 가능한 한 작업자 IP로 제한한다. k3s API(6443)는 외부 노출이 필요 없으면 공개하지 않는다.

### Decision: SQLite 데이터는 hostPath로 보존한다

현재 backend는 hostPath `/var/lib/infinite-buying/backend`(`DirectoryOrCreate`)를 마운트한다. A1 노드에서도 동일 경로를 사용해 manifest 변경 없이 데이터를 잇는다.

- backend data: `/var/lib/infinite-buying/backend`
- SQLite DB: `/var/lib/infinite-buying/backend/app.db`

`SECRET_ENCRYPTION_KEY`가 바뀌면 KIS App Secret/access token/account number 복호화가 깨지므로, `infinite-buying-secrets`를 기존 값 그대로 새 cluster에 재생성한다. 이 Secret은 Argo CD가 manifest로 관리하지 않고 cluster에 직접 생성하는 값이므로, sync와 별개로 수동 주입한다.

### Decision: Route53은 유지하고 A record만 바꾼다

DNS hosted zone은 비용이 작고 이미 운영 도메인을 관리하고 있으므로 유지한다. 전환 시 `infinite-buying.yuna-pa.com` A record를 A1 public IP로 변경한다. `www` CNAME은 그대로 유지한다.

TTL은 현재 300초이므로 cutover 전후 전파 지연은 짧다. cert-manager가 Let's Encrypt 인증서를 HTTP-01로 발급받으려면 DNS 전환 직후 80/443이 A1으로 열려 있어야 한다.

## Risks / Trade-offs

- OCI A1 capacity 불확실성 → A1 Always Free는 "Out of host capacity"가 잦다. CLI quota 조회는 사용 가능량을 보여줄 뿐 생성 성공을 보장하지 않는다. 이번 migration은 Always Free 최대치인 4 OCPU / 24GB RAM 확보를 목표로 하므로 shape을 낮추지 않고, EC2 retry runner가 구독된 리전을 순회하며 capacity가 생길 때까지 반복 시도한다.
- ARM64 image 호환성 → buildx/QEMU 또는 ARM runner로 `linux/arm64`를 빌드하고, A1에서 pull/run smoke test를 먼저 한다. 네이티브 모듈 빌드 실패에 대비해 빌드 로그를 확인한다.
- 단일 노드 SPOF → 노드 장애 시 서비스가 중단된다(현재 EC2와 동일). rollback용 AWS EC2를 안정화 전까지 유지하고, DB backup 복구 절차를 문서화한다. 다중 노드 HA는 backend SQLite 단일 writer 특성상 복제 스토리지가 필요해 이번 범위에서 제외한다.
- OCIR 인증 → public pull 가능이면 pull secret 불필요. private이면 OCIR auth token 기반 pull secret을 주입한다. GitHub Actions push에는 OCIR registry credential이 필요하다.
- SQLite 데이터 유실/분기 → cutover 직전 EC2 backend를 멈춘 상태에서 `sqlite3 .backup`으로 정합 백업을 뜨고(`cp`는 write 도중 반쪽 위험), A1 복원 후 row count·로그인·KIS 설정 조회로 검증한다.
- Secret 불일치 → 기존 `SECRET_ENCRYPTION_KEY`, `SESSION_SECRET`을 A1 `infinite-buying-secrets`에 동일하게 주입하기 전까지 backend를 띄우지 않는다.
- Scheduler 중복 실행 → DNS cutover 전 smoke test 동안에는 A1 backend의 `ENABLE_LIVE_ORDER=false`(또는 `AUTO_TRADING_SCHEDULER_ENABLED=false`)로 두거나 EC2 backend를 `replicas: 0`으로 내려, AWS·Oracle 두 scheduler가 동시에 실주문을 내지 않게 한다.
- TLS 발급 실패 → DNS 전환과 80/443 방화벽(OCI security rule + 노드 방화벽) 상태를 확인하고, cert-manager Challenge/Order와 Traefik 라우팅 상태로 발급을 검증한다.

## Migration Plan

1. OCI 네트워크를 새로 구성한다.
   - 현재 OCI config의 target region과 선택한 availability domain을 사용한다.
   - VCN, public subnet, internet gateway, route table(`0.0.0.0/0` → IGW)을 생성한다.
   - security list 또는 NSG에서 22/80/443 ingress를 설정한다(22는 작업자 IP 제한).

2. Ampere A1 Compute instance를 생성한다.
   - Ubuntu ARM64 image, A1 shape **4 OCPU / 24GB RAM**(Always Free 최대).
   - public IP를 기록한다. `Out of host capacity`가 잦으므로 `infra/operations/ensure-oci-a1-region-envs.sh`와 `infra/operations/try-create-oci-a1-all-regions.sh`를 cron으로 돌려, 구독 리전별 네트워크 env를 준비하고 확보될 때까지 재시도한다.

3. A1 노드에 k3s 단일 server를 설치한다.
   - 번들 Traefik/ServiceLB 사용.
   - swap 및 메모리 확인.
   - `/var/lib/infinite-buying/backend` 생성(hostPath).

4. cluster 부가 구성요소를 설치한다.
   - Argo CD 설치 및 `infra/kubernetes/argocd/applications/infinite-buying-mvp.yaml` Application 등록.
   - cert-manager 설치 및 `letsencrypt-prod` ClusterIssuer 생성.

5. OCIR/ARM64 기준으로 GitHub Actions를 변경한다.
   - AWS credentials/ECR login/ECR repo 생성/ECR push 제거.
   - OCIR login 설정 추가, AWS OIDC `id-token` 권한 제거.
   - buildx/QEMU(또는 ARM runner)로 `linux/arm64` build + OCIR push.
   - GitOps commit 단계의 image newName을 OCIR 경로로 변경.

6. Kubernetes manifest를 OCIR 기준으로 정리한다.
   - `overlays/mvp/kustomization.yaml`의 image name/newName을 OCIR로 변경.
   - backend/frontend Deployment의 `imagePullSecrets`를 제거(public) 또는 OCIR pull secret으로 교체(private).
   - `ecr-refresh-cronjob.yaml`, `ecr-refresh-rbac.yaml`을 base kustomization에서 제거.

7. 운영 secret을 A1 cluster에 생성한다.
   - 기존 값 그대로 `infinite-buying-secrets`(`SECRET_ENCRYPTION_KEY`, `SESSION_SECRET`, KIS 관련 값) 생성.
   - private OCIR면 auth token 기반 dockerconfigjson Secret 생성.

8. EC2 DB를 백업하고 A1로 복원한다.
   - cutover 직전 EC2 backend를 `replicas: 0`으로 내린 뒤 `sqlite3 app.db ".backup"`으로 정합 백업.
   - A1 `/var/lib/infinite-buying/backend/app.db`로 복원, checksum·size 확인.

9. A1 환경에서 smoke test를 수행한다(이 단계까지 A1 backend는 `ENABLE_LIVE_ORDER=false`).
   - `kubectl get pods`, Argo CD sync 상태.
   - `/api/health`, 로그인, KIS 설정 조회, 백테스트 화면, 자동매매 화면, 최근 주문/로그.

10. Route53 A record를 A1 public IP로 변경한다.
   - cert-manager가 HTTP-01로 인증서를 발급하는지 확인한다.

11. cutover를 확정한다.
   - A1 backend `ENABLE_LIVE_ORDER`를 운영 값으로 전환하고, EC2 backend가 내려가 있는지(단일 scheduler) 재확인.
   - pod health, cert-manager/Traefik, backend·scheduler logs, KIS token 발급 모니터링.

12. 안정화 후 AWS 리소스를 정리한다.
   - EC2 stop 후 일정 시간 대기 → 최종 DB backup 보관 → EC2 terminate.
   - EBS delete, Elastic IP release.
   - ECR repositories delete 또는 lifecycle policy 적용.
   - 불필요한 VPC/security group 정리.
   - Route53 hosted zone은 유지.

## Rollback Plan

Oracle 전환 후 문제가 발생하면 Route53 A record를 다시 `3.39.3.103`으로 되돌린다. rollback 가능성을 유지하기 위해 Oracle 안정화 전까지 AWS EC2와 EBS는 삭제하지 않는다.

DB rollback이 필요한 경우, cutover 직전 EC2 DB backup을 기준으로 복원한다. Oracle에서 신규 주문/설정 변경이 발생한 뒤 rollback하면 데이터 분기 문제가 생기므로, cutover window 동안에는 A1 backend `ENABLE_LIVE_ORDER=false`를 유지하거나 maintenance 공지를 둔다.

## Open Questions

- A1 Always Free instance를 원하는 시점에 확보할 수 있는가(capacity)?
- OCIR repository는 public pull 가능하게 둘 것인가, private으로 두고 OCIR auth token을 사용할 것인가?
- ARM64 빌드는 QEMU 에뮬레이션으로 충분한가, ARM runner가 필요한가?
- cutover 동안 실주문 실행을 `ENABLE_LIVE_ORDER=false`로 끌 것인가?
