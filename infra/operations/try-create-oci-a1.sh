#!/usr/bin/env bash
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEFAULT_ENV_FILE="$REPO_ROOT/openspec/changes/migrate-aws-ec2-to-oracle-k3s/oci-resources.env"

OCI_BIN="${OCI_BIN:-}"
ENV_FILE="${ENV_FILE:-$DEFAULT_ENV_FILE}"
LOG_FILE="${LOG_FILE:-$HOME/oci-a1-create.log}"
SUCCESS_FLAG="${SUCCESS_FLAG:-$HOME/.oci-a1-created}"
LOCK_DIR="${LOCK_DIR:-/tmp/infinite-buying-oci-a1-create.lock}"

INSTANCE_NAME="${INSTANCE_NAME:-infinite-buying-a1-k3s}"
SSH_KEY_FILE="${SSH_KEY_FILE:-$HOME/.ssh/study-note-yuna-pa.pub}"
OCPUS="${OCPUS:-4}"
MEMORY_GB="${MEMORY_GB:-24}"
BOOT_VOLUME_GB="${BOOT_VOLUME_GB:-100}"
OPERATING_SYSTEM="${OPERATING_SYSTEM:-Canonical Ubuntu}"
IMAGE_NAME_FILTER="${IMAGE_NAME_FILTER:-22.04}"

# Optional Telegram notification. Leave empty to disable.
TELEGRAM_TOKEN="${TELEGRAM_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"

# Heartbeat: while the loop keeps failing (e.g. Out of host capacity), send at most one
# Telegram message per HEARTBEAT_INTERVAL seconds so you can confirm the retry is still
# alive without getting a message every minute. The message summarizes how many attempts
# were made in the window and the last failure reason. Default: once every 30 minutes.
HEARTBEAT_INTERVAL="${HEARTBEAT_INTERVAL:-1800}"
HEARTBEAT_FILE="${HEARTBEAT_FILE:-$HOME/.oci-a1-heartbeat}"
ATTEMPT_COUNT_FILE="${ATTEMPT_COUNT_FILE:-$HOME/.oci-a1-attempts}"
LAST_ERROR_FILE="${LAST_ERROR_FILE:-$HOME/.oci-a1-last-error}"

log() {
  printf '%s: %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$*" >> "$LOG_FILE"
}

notify() {
  local message="$1"
  if [ -n "$TELEGRAM_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
    curl -fsS -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
      -d chat_id="$TELEGRAM_CHAT_ID" \
      -d text="$message" >/dev/null 2>&1 || true
  fi
}

# Record one failed attempt: increment the windowed attempt counter, remember the last
# error, then send a heartbeat if the interval has elapsed. State is persisted in files
# because each cron run is a fresh process.
record_failure() {
  local reason="$1"
  local count
  count="$(cat "$ATTEMPT_COUNT_FILE" 2>/dev/null || echo 0)"
  case "$count" in ''|*[!0-9]*) count=0 ;; esac
  count=$((count + 1))
  printf '%s\n' "$count" > "$ATTEMPT_COUNT_FILE"
  printf '%s\n' "$reason" > "$LAST_ERROR_FILE"
  maybe_heartbeat
}

# If HEARTBEAT_INTERVAL has elapsed since the last heartbeat, send a Telegram summary of
# the attempts made in the window and the last failure reason, then reset the window.
maybe_heartbeat() {
  local now last count reason mins
  now="$(date +%s)"
  last="$(cat "$HEARTBEAT_FILE" 2>/dev/null || echo 0)"
  case "$last" in ''|*[!0-9]*) last=0 ;; esac
  if [ "$((now - last))" -lt "$HEARTBEAT_INTERVAL" ]; then
    return 0
  fi
  count="$(cat "$ATTEMPT_COUNT_FILE" 2>/dev/null || echo 0)"
  case "$count" in ''|*[!0-9]*) count=0 ;; esac
  reason="$(cat "$LAST_ERROR_FILE" 2>/dev/null || echo unknown)"
  mins=$((HEARTBEAT_INTERVAL / 60))
  notify "[infinite-buying A1] 아직 생성 못 함 — 최근 ${mins}분간 ${count}회 시도, 모두 실패. 마지막 에러: ${reason:-unknown} (shape ${OCPUS}OCPU/${MEMORY_GB}GB, region ${OCI_REGION:-default}, host $(hostname 2>/dev/null || echo unknown))"
  printf '%s\n' "$now" > "$HEARTBEAT_FILE"
  printf '0\n' > "$ATTEMPT_COUNT_FILE"
}

fail() {
  log "ERROR: $*"
  record_failure "hard error: $*"
  exit 1
}

if [ -f "$SUCCESS_FLAG" ]; then
  exit 0
fi

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  log "Another create attempt is already running. Exiting."
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

if [ -z "$OCI_BIN" ]; then
  if command -v oci >/dev/null 2>&1; then
    OCI_BIN="$(command -v oci)"
  elif [ -x "$HOME/bin/oci" ]; then
    OCI_BIN="$HOME/bin/oci"
  else
    fail "OCI CLI not found. Set OCI_BIN=/path/to/oci."
  fi
fi

[ -x "$OCI_BIN" ] || fail "OCI CLI is not executable: $OCI_BIN"
[ -f "$ENV_FILE" ] || fail "OCI resource env file not found: $ENV_FILE"
[ -f "$SSH_KEY_FILE" ] || fail "SSH public key file not found: $SSH_KEY_FILE"

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

: "${OCI_COMPARTMENT_ID:?missing OCI_COMPARTMENT_ID in env file}"
: "${OCI_AVAILABILITY_DOMAIN:?missing OCI_AVAILABILITY_DOMAIN in env file}"
: "${OCI_SUBNET_ID:?missing OCI_SUBNET_ID in env file}"

REGION_ARGS=()
if [ -n "${OCI_REGION:-}" ]; then
  REGION_ARGS=(--region "$OCI_REGION")
fi

log "Attempting OCI A1 launch: region=${OCI_REGION:-default} name=$INSTANCE_NAME shape=VM.Standard.A1.Flex ocpus=$OCPUS memory=${MEMORY_GB}GB boot=${BOOT_VOLUME_GB}GB"

EXISTING_INSTANCE_ID="$("$OCI_BIN" "${REGION_ARGS[@]}" compute instance list \
  --compartment-id "$OCI_COMPARTMENT_ID" \
  --all \
  --query "data[?\"display-name\"=='${INSTANCE_NAME}' && \"lifecycle-state\"!='TERMINATED'] | [0].id" \
  --raw-output 2>>"$LOG_FILE" || true)"

if [ -n "$EXISTING_INSTANCE_ID" ] && [ "$EXISTING_INSTANCE_ID" != "null" ]; then
  log "Existing non-terminated instance found: $EXISTING_INSTANCE_ID"
  touch "$SUCCESS_FLAG"
  exit 0
fi

IMAGE_ID="$("$OCI_BIN" "${REGION_ARGS[@]}" compute image list \
  --compartment-id "$OCI_COMPARTMENT_ID" \
  --operating-system "$OPERATING_SYSTEM" \
  --shape VM.Standard.A1.Flex \
  --all \
  --query "data[?contains(\"display-name\", '${IMAGE_NAME_FILTER}')]|sort_by(@,&\"time-created\")[-1].id" \
  --raw-output 2>>"$LOG_FILE" || true)"

if [ -z "$IMAGE_ID" ] || [ "$IMAGE_ID" = "null" ]; then
  fail "Unable to find ARM image for ${OPERATING_SYSTEM} ${IMAGE_NAME_FILTER}."
fi

RESULT="$("$OCI_BIN" "${REGION_ARGS[@]}" compute instance launch \
  --compartment-id "$OCI_COMPARTMENT_ID" \
  --availability-domain "$OCI_AVAILABILITY_DOMAIN" \
  --shape VM.Standard.A1.Flex \
  --shape-config "{\"ocpus\":${OCPUS},\"memoryInGBs\":${MEMORY_GB}}" \
  --subnet-id "$OCI_SUBNET_ID" \
  --source-details "{\"sourceType\":\"image\",\"imageId\":\"${IMAGE_ID}\",\"bootVolumeSizeInGBs\":${BOOT_VOLUME_GB}}" \
  --assign-public-ip true \
  --ssh-authorized-keys-file "$SSH_KEY_FILE" \
  --display-name "$INSTANCE_NAME" \
  --wait-for-state RUNNING \
  --max-wait-seconds 300 \
  --query 'data.id' \
  --raw-output 2>&1)"
EXIT_CODE=$?

if [ "$EXIT_CODE" -ne 0 ] || [ -z "$RESULT" ] || [ "$RESULT" = "null" ] || ! printf '%s' "$RESULT" | grep -q '^ocid1.instance'; then
  log "Failed to launch instance. exit_code=$EXIT_CODE"
  log "$RESULT"
  log "---"
  REASON="$(printf '%s\n' "$RESULT" | grep -iom1 'Out of host capacity\|TooManyRequests\|LimitExceeded\|[A-Za-z]*Capacity[A-Za-z]*' || printf '%s' "$RESULT" | head -n1)"
  record_failure "${REASON:-launch failed (exit ${EXIT_CODE})}"
  exit 1
fi

INSTANCE_ID="$RESULT"
log "SUCCESS: instance created and RUNNING: $INSTANCE_ID"

VNIC_ID="$("$OCI_BIN" "${REGION_ARGS[@]}" compute vnic-attachment list \
  --compartment-id "$OCI_COMPARTMENT_ID" \
  --instance-id "$INSTANCE_ID" \
  --all \
  --query 'data[0]."vnic-id"' \
  --raw-output 2>>"$LOG_FILE" || true)"

PUBLIC_IP=""
PRIVATE_IP=""
if [ -n "$VNIC_ID" ] && [ "$VNIC_ID" != "null" ]; then
  PUBLIC_IP="$("$OCI_BIN" "${REGION_ARGS[@]}" network vnic get --vnic-id "$VNIC_ID" --query 'data."public-ip"' --raw-output 2>>"$LOG_FILE" || true)"
  PRIVATE_IP="$("$OCI_BIN" "${REGION_ARGS[@]}" network vnic get --vnic-id "$VNIC_ID" --query 'data."private-ip"' --raw-output 2>>"$LOG_FILE" || true)"
fi

{
  printf '\n# Created by infra/operations/try-create-oci-a1.sh at %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')"
  printf 'OCI_INSTANCE_ID=%s\n' "$INSTANCE_ID"
  [ -n "$VNIC_ID" ] && [ "$VNIC_ID" != "null" ] && printf 'OCI_VNIC_ID=%s\n' "$VNIC_ID"
  [ -n "$PUBLIC_IP" ] && [ "$PUBLIC_IP" != "null" ] && printf 'OCI_INSTANCE_PUBLIC_IP=%s\n' "$PUBLIC_IP"
  [ -n "$PRIVATE_IP" ] && [ "$PRIVATE_IP" != "null" ] && printf 'OCI_INSTANCE_PRIVATE_IP=%s\n' "$PRIVATE_IP"
} >> "$ENV_FILE"

touch "$SUCCESS_FLAG"
notify "[infinite-buying A1] ✅ 인스턴스 생성 완료: ${INSTANCE_NAME} (${OCPUS}OCPU/${MEMORY_GB}GB, region ${OCI_REGION:-default})${PUBLIC_IP:+, public IP ${PUBLIC_IP}}"

log "Instance details: public_ip=${PUBLIC_IP:-unknown} private_ip=${PRIVATE_IP:-unknown}"
