# Operations Scripts

이 디렉터리는 운영 서버에서 수동 또는 cron으로 실행하는 보조 스크립트를 둔다.

## OCI A1 Retry Scripts

Oracle Cloud Ampere A1 capacity가 생길 때까지 VM 생성을 반복 시도하는 스크립트 묶음이다. **2026-06-02 홈 리전(춘천)에서 A1을 확보해 이전이 완료**됐으므로 현재는 비활성이며, 향후 홈 리전 A1 capacity가 다시 필요할 때 재사용할 수 있도록 보존한다. 운영 노드의 cron에서 `try-create-oci-a1.sh`를 돌려 성공 시 `~/.oci-a1-created` 플래그로 정지하고, `NOTIFY_EVERY_ATTEMPT=1`이면 매 시도마다(기본은 30분마다) Telegram으로 결과를 보낸다. **Always Free A1은 홈 리전에서만 무료**이므로 비-홈 리전 생성은 과금된다.

현재 목표 shape:

- `VM.Standard.A1.Flex`
- `4 OCPU / 24GB RAM`
- boot volume `100GB`

### `ensure-oci-a1-region-envs.sh`

구독된 리전마다 A1 생성에 필요한 VCN/subnet/security list env 파일을 준비한다. 새 리전 구독 직후 IAM/API key 인증 전파가 끝나지 않았으면 해당 리전은 건너뛰고 다음 cron에서 다시 확인한다.

기본 대상 리전:

- `ap-seoul-1`
- `ap-tokyo-1`
- `ap-chuncheon-1`

각 리전 env 파일 이름은 `oci-resources-<region>.env` 형식을 사용한다.

### `try-create-oci-a1-all-regions.sh`

리전별 env 파일을 순서대로 읽어 `try-create-oci-a1.sh`를 호출한다. 기본 순서는 서울, 도쿄, 춘천이다. 한 리전에서 생성 요청이 진행 중이면 lock으로 다음 cron 실행은 건너뛴다.

### `try-create-oci-a1.sh`

단일 리전에서 A1 생성을 시도한다.

동작:

- OCI resource env 파일에서 region, compartment, availability domain, subnet을 읽는다.
- Ubuntu 22.04 ARM image를 조회해 사용한다.
- 이미 같은 이름의 non-terminated instance가 있으면 중복 생성하지 않는다.
- 생성 성공 시 success flag를 만들고 이후 재시도를 멈춘다.
- 생성 성공 시 instance/VNIC/public IP/private IP를 env 파일에 기록한다.
- Telegram 설정이 있으면 성공 알림을 즉시 보낸다.
- 실패가 계속되면 30분마다 최근 시도 횟수와 마지막 실패 사유를 heartbeat로 보낸다.
- lock directory로 중복 실행을 막는다. 1분 cron이어도 이전 OCI 요청이 아직 끝나지 않았으면 다음 실행은 건너뛴다.

필요한 runtime env:

```bash
OCI_BIN=/path/to/oci
ENV_FILE=/path/to/oci-resources.env
LOG_FILE=/path/to/oci-a1-create.log
SUCCESS_FLAG=/path/to/.oci-a1-created
SSH_KEY_FILE=/path/to/public-key.pub
OCPUS=4
MEMORY_GB=24
BOOT_VOLUME_GB=100
HEARTBEAT_INTERVAL=1800
TARGET_REGIONS="ap-seoul-1 ap-tokyo-1 ap-chuncheon-1"
TELEGRAM_TOKEN=...
TELEGRAM_CHAT_ID=...
```

`TELEGRAM_TOKEN`, OCI API key, `retry.env`, `oci-resources.env` 같은 실행 값은 git에 커밋하지 않는다.

과거 EC2 retry runner cron 예시:

```cron
* * * * * set -a; . /home/<user>/oci-a1-retry/retry.env; set +a; /home/<user>/oci-a1-retry/ensure-oci-a1-region-envs.sh; /home/<user>/oci-a1-retry/try-create-oci-a1-all-regions.sh >/dev/null 2>&1
```

로그 확인:

```bash
tail -f ~/oci-a1-create.log
```

## `install-ec2-runtime-guards.sh`

과거 AWS EC2 k3s 런타임의 DNS loop와 메모리 압박을 완화하던 guard 설치 스크립트다. 현재 production은 OCI A1에서 동작하므로 이 스크립트는 운영 적용 대상이 아니라 이전 기록과 재현용으로만 보존한다.
