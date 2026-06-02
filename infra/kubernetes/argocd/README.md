# Argo CD 운영 메모

현재 production은 Oracle Cloud Ampere A1 단일 노드 k3s 위에서 동작한다. 운영 노드는 OCI 홈 리전 춘천(`ap-chuncheon-1`)의 Always Free A1(`4 OCPU / 24GB RAM`)이며, 2026-06-02에 AWS EC2에서 이전했다.

이 클러스터는 `argocd-server`와 GitHub webhook 없이 Argo CD core 컴포넌트로 애플리케이션을 동기화한다.
따라서 GitHub Actions가 GitOps image tag 커밋을 push한 직후에는 Argo CD가 아직 이전 Git revision을 보고 있을 수 있다.

`runtime-tuning.yaml`은 poll 기반 자동 동기화 지연을 줄이기 위한 운영 설정이다.

- `timeout.reconciliation`: 애플리케이션 상태를 Git과 다시 비교하는 주기
- `timeout.reconciliation.jitter`: 비교 요청이 몰리지 않도록 추가되는 지연
- `reposerver.repo.cache.expiration`: repo-server가 Git revision/cache를 재사용하는 시간
- `controller.app.state.cache.expiration`: application-controller 상태 cache 재사용 시간

설정 변경 후에는 `argocd-application-controller`와 `argocd-repo-server`를 재시작해야 한다.

## Oracle A1/k3s 운영 메모

- backend는 SQLite 단일 writer와 scheduler를 포함하므로 production replica를 1개로 유지한다.
- 이미지 registry는 GHCR이다. 운영 매니페스트에는 AWS ECR pull secret이나 ECR token refresh CronJob이 없어야 한다.
- TLS는 cert-manager `letsencrypt-prod` ClusterIssuer와 Traefik ingress로 처리한다.
- `SECRET_ENCRYPTION_KEY`와 `SESSION_SECRET`은 `infinite-buying-secrets` Kubernetes Secret으로 주입한다. 노드를 옮길 때 같은 값을 보존해야 기존 KIS credential을 복호화할 수 있다.
- Route53은 DNS authority로 유지하지만, 런타임은 OCI A1 클러스터다.

## 과거 EC2 DNS Loop Guard 기록

AWS EC2 운영 당시에는 AWS VPC 대역과 k3s 기본 Pod CIDR이 겹쳐 CoreDNS loop가 발생할 수 있었다. `infra/operations/install-ec2-runtime-guards.sh`는 그 시절의 복구/기록용 스크립트로 남겨 둔다.

현재 OCI A1 운영 노드에는 이 EC2 guard를 적용하지 않는다. 새 k3s 클러스터를 만들 때는 VCN/VPC 대역과 겹치지 않는 `--cluster-cidr`를 지정한다.
