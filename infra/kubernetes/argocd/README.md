# Argo CD 운영 메모

이 클러스터는 `argocd-server`와 GitHub webhook 없이 Argo CD core 컴포넌트로 애플리케이션을 동기화한다.
따라서 GitHub Actions가 GitOps image tag 커밋을 push한 직후에는 Argo CD가 아직 이전 Git revision을 보고 있을 수 있다.

`runtime-tuning.yaml`은 poll 기반 자동 동기화 지연을 줄이기 위한 운영 설정이다.

- `timeout.reconciliation`: 애플리케이션 상태를 Git과 다시 비교하는 주기
- `timeout.reconciliation.jitter`: 비교 요청이 몰리지 않도록 추가되는 지연
- `reposerver.repo.cache.expiration`: repo-server가 Git revision/cache를 재사용하는 시간
- `controller.app.state.cache.expiration`: application-controller 상태 cache 재사용 시간

설정 변경 후에는 `argocd-application-controller`와 `argocd-repo-server`를 재시작해야 한다.
