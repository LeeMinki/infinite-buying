# Operations Scripts

이 디렉터리는 운영 서버에서 수동 또는 cron으로 실행하는 보조 스크립트를 둔다.

## OCI A1 Retry Scripts

Oracle Cloud Ampere A1 capacity가 생길 때까지 VM 생성을 반복 시도하는 스크립트 묶음이다. AWS EC2에서 Oracle 이전 준비용으로 실행 중이며, A1 VM이 성공적으로 생성되면 이후 k3s/Argo CD/GHCR/DB 이전 작업을 이어간다.

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

EC2 cron 예시:

```cron
* * * * * set -a; . /home/<user>/oci-a1-retry/retry.env; set +a; /home/<user>/oci-a1-retry/ensure-oci-a1-region-envs.sh; /home/<user>/oci-a1-retry/try-create-oci-a1-all-regions.sh >/dev/null 2>&1
```

로그 확인:

```bash
tail -f ~/oci-a1-create.log
```

## `install-ec2-runtime-guards.sh`

현재 AWS EC2 k3s 런타임의 DNS loop와 메모리 압박을 완화하는 guard를 설치한다. Oracle 이전이 완료되기 전까지 AWS EC2는 rollback 대상이므로, 이 스크립트와 EC2 운영 메모는 유지한다.
