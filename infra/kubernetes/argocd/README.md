# Argo CD 운영 메모

현재 production은 AWS EC2 단일 노드 k3s 위에서 동작한다. Oracle Cloud Ampere A1로 이전하는 작업은 `openspec/changes/migrate-aws-ec2-to-oracle-k3s`에서 진행 중이며, A1 VM 생성과 smoke test가 끝나기 전까지 이 문서는 EC2 운영 기준으로 유지한다.

이 클러스터는 `argocd-server`와 GitHub webhook 없이 Argo CD core 컴포넌트로 애플리케이션을 동기화한다.
따라서 GitHub Actions가 GitOps image tag 커밋을 push한 직후에는 Argo CD가 아직 이전 Git revision을 보고 있을 수 있다.

`runtime-tuning.yaml`은 poll 기반 자동 동기화 지연을 줄이기 위한 운영 설정이다.

- `timeout.reconciliation`: 애플리케이션 상태를 Git과 다시 비교하는 주기
- `timeout.reconciliation.jitter`: 비교 요청이 몰리지 않도록 추가되는 지연
- `reposerver.repo.cache.expiration`: repo-server가 Git revision/cache를 재사용하는 시간
- `controller.app.state.cache.expiration`: application-controller 상태 cache 재사용 시간

설정 변경 후에는 `argocd-application-controller`와 `argocd-repo-server`를 재시작해야 한다.

## EC2/k3s DNS Loop Guard

현재 EC2는 AWS VPC 대역이 `10.42.0.0/16`이고, k3s 기본 Pod CIDR도 `10.42.0.0/16`이라 충돌할 수 있다. AWS VPC DNS는 VPC base+2 주소인 `10.42.0.2`인데, CoreDNS pod도 같은 대역의 IP를 받을 수 있어 CoreDNS가 자기 자신에게 forward하는 loop가 발생한다.

운영 EC2에는 다음 방어 설정을 적용한다.

- systemd-resolved가 DHCP로 받은 `10.42.0.2`를 사용하지 않도록 netplan에서 DHCP DNS 수용을 끈다.
- 노드 DNS는 AWS link-local resolver `169.254.169.253`을 우선 사용한다.
- CoreDNS `forward` upstream은 `/etc/resolv.conf`가 아니라 `169.254.169.253 1.1.1.1 8.8.8.8`로 고정한다.
- `infinite-buying-dns-guard.timer`가 5분마다 CoreDNS와 노드 DNS 설정이 되돌아가지 않았는지 확인한다.
- swap 2GB를 켜서 t3.small에서 k3s/Argo CD가 메모리 압박으로 멈추지 않게 한다.

운영 EC2에서 재적용이 필요하면 다음 스크립트를 실행한다.

```bash
sudo infra/operations/install-ec2-runtime-guards.sh
```

장기적으로 클러스터를 새로 만들 때는 k3s `--cluster-cidr`를 VPC와 겹치지 않는 대역, 예를 들어 `10.244.0.0/16`, 으로 지정하는 것이 더 근본적인 해결책이다.
