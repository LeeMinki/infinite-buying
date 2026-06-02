## Why

현재 운영 환경은 AWS EC2 `t3.small` 단일 노드에서 k3s, Argo CD, Traefik, cert-manager, 애플리케이션을 모두 실행한다. EC2를 24시간 유지하면서 월 비용이 커졌다. Oracle Cloud의 Always Free Ampere A1(ARM64)은 최대 4 OCPU / 24GiB까지 무료로 쓸 수 있어, 현재 EC2(1.9GiB)보다 오히려 메모리 여유가 크다. 따라서 메모리 때문에 k3s/Argo CD 구조를 포기할 이유가 없고, 현재의 단일 노드 k3s + Argo CD GitOps 운영을 그대로 ARM A1 VM으로 리프트앤시프트하는 것이 학습된 운영 절차·GitOps self-heal·기존 manifest를 보존하는 가장 안전한 선택이다.

따라서 운영 아키텍처(단일 노드 k3s + Argo CD + cert-manager + Traefik)는 유지하고, AWS 종속 부분만 교체한다: 이미지 레지스트리를 ECR에서 GHCR로 옮기고, 이미지를 ARM64로 빌드하며, OCI 네트워크와 A1 VM을 새로 구성한 뒤 데이터·secret을 이전하고 DNS를 전환한다.

## What Changes

- Oracle Cloud에 Ampere A1(ARM64) Always Free VM 1대(**4 OCPU / 24GB RAM**, Always Free 최대)를 단일 노드 k3s 호스트로 구성한다(리전·compartment·AD는 apply 시 현재 OCI config 기준으로 확정).
- 현재 OCI root compartment에는 재사용할 Compute instance와 VCN이 없으므로 VCN, public subnet, internet gateway, route table, security rule을 새로 구성한다.
- 운영 아키텍처는 유지한다: 단일 노드 k3s 위에 Argo CD, cert-manager, k3s 번들 Traefik, infinite-buying backend/frontend.
- GitHub merge 후 자동 배포는 **Argo CD GitOps 그대로** 유지한다. SSH direct deploy로 바꾸지 않는다.
- AWS ECR 중심 이미지 배포를 GHCR 중심으로 변경한다.
- GitHub Actions는 ARM64(또는 multi-architecture) 이미지를 빌드해 GHCR로 push하고, 기존처럼 kustomization image tag를 commit해 Argo CD가 sync하게 한다.
- ECR 인증 토큰을 6시간마다 갱신하던 `ecr-secret-refresh` CronJob과 ECR `imagePullSecrets` 의존을 제거한다. GHCR package를 public으로 두거나, private이면 만료되지 않는 GHCR pull token을 dockerconfigjson Secret으로 한 번만 주입한다.
- backend SQLite 데이터는 현재 node hostPath `/var/lib/infinite-buying/backend/app.db`에서 A1 노드의 동일 hostPath로 백업/복원한다.
- `SECRET_ENCRYPTION_KEY`, `SESSION_SECRET`, KIS 관련 운영 secret(`infinite-buying-secrets`)은 기존 값을 유지해 기존 사용자 credential 복호화가 깨지지 않게 한다.
- Route53 hosted zone은 유지하고, `infinite-buying.yuna-pa.com` A record만 A1 public IP로 전환한다.
- Oracle 환경 검증 후 AWS EC2, EBS, Elastic IP, ECR repository, 불필요한 VPC 리소스를 정리한다.
- **BREAKING**: 이미지 레지스트리가 AWS ECR에서 GHCR로 바뀌고, 빌드 아키텍처가 ARM64로 바뀐다. amd64 전용 ECR 이미지와 ECR refresh CronJob을 사용하던 배포 경로는 더 이상 동작하지 않는다.

## Capabilities

### New Capabilities

- `oracle-k3s-migration`: AWS EC2 단일 노드 k3s/Argo CD 운영 환경을 Oracle Ampere A1(ARM64) 단일 노드 k3s 환경으로 리프트앤시프트하고, GHCR 이미지 registry, ARM64 빌드, OCI 네트워크 bootstrap, 데이터·secret 이전, DNS 전환, AWS 정리 절차를 정의한다.

### Modified Capabilities

- 없음.

## Impact

- GitHub Actions workflow: AWS ECR login/build/push를 GHCR login/ARM64 build/push로 교체한다. GitOps image tag commit 단계는 유지하되 image newName을 GHCR 경로로 바꾼다. `packages: write` 권한을 추가하고 AWS OIDC `id-token` 권한을 제거한다.
- Kubernetes manifests: 기존 base/overlay를 그대로 재사용한다. 변경점은 image newName(ECR→GHCR), `imagePullSecrets`(ecr-registry 제거), `ecr-refresh-cronjob`/`ecr-refresh-rbac` 제거뿐이다.
- Infrastructure: OCI 네트워크 리소스(VCN/subnet/IGW/route/security), Ampere A1 ARM VM 1대, 단일 노드 k3s, Argo CD, cert-manager, k3s 번들 Traefik, `infinite-buying-secrets` Secret, hostPath data directory가 필요하다.
- Data: SQLite `app.db`와 운영 secrets를 안전하게 이전해야 한다.
- DNS: Route53 hosted zone은 유지하되 `infinite-buying.yuna-pa.com` A record를 A1 public IP로 변경한다.
- Operations: 단일 노드 구성이므로 노드 장애 시 서비스가 중단된다(현재 EC2와 동일 수준). Oracle 환경 정상 검증 전까지 AWS EC2를 rollback 대상으로 유지한다.
