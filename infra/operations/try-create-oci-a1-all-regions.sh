#!/usr/bin/env bash
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

OCI_BIN="${OCI_BIN:-}"
LOG_FILE="${LOG_FILE:-$HOME/oci-a1-create.log}"
SUCCESS_FLAG="${SUCCESS_FLAG:-$HOME/.oci-a1-created}"
MULTI_LOCK_DIR="${MULTI_LOCK_DIR:-/tmp/infinite-buying-oci-a1-multi-region.lock}"
RETRY_SCRIPT="${RETRY_SCRIPT:-$SCRIPT_DIR/try-create-oci-a1.sh}"

ENV_FILES="${ENV_FILES:-}"
if [ -z "$ENV_FILES" ]; then
  ENV_FILES="$HOME/oci-a1-retry/oci-resources-ap-seoul-1.env $HOME/oci-a1-retry/oci-resources-ap-tokyo-1.env $HOME/oci-a1-retry/oci-resources-ap-chuncheon-1.env"
  if [ ! -f "$HOME/oci-a1-retry/oci-resources-ap-chuncheon-1.env" ] && [ -f "$HOME/oci-a1-retry/oci-resources.env" ]; then
    ENV_FILES="$ENV_FILES $HOME/oci-a1-retry/oci-resources.env"
  fi
fi

log() {
  printf '%s: %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$*" >> "$LOG_FILE"
}

if [ -f "$SUCCESS_FLAG" ]; then
  exit 0
fi

if ! mkdir "$MULTI_LOCK_DIR" 2>/dev/null; then
  log "Another multi-region create attempt is already running. Exiting."
  exit 0
fi
trap 'rmdir "$MULTI_LOCK_DIR" 2>/dev/null || true' EXIT

[ -x "$RETRY_SCRIPT" ] || {
  log "ERROR: retry script is not executable: $RETRY_SCRIPT"
  exit 1
}

attempted=0
for env_file in $ENV_FILES; do
  [ -f "$env_file" ] || {
    log "Skipping missing region env file: $env_file"
    continue
  }

  attempted=$((attempted + 1))
  region="$(awk -F= '/^OCI_REGION=/{print $2; exit}' "$env_file" 2>/dev/null || true)"
  log "Starting region attempt: ${region:-unknown} env=$env_file"

  ENV_FILE="$env_file" \
  OCI_BIN="$OCI_BIN" \
  LOG_FILE="$LOG_FILE" \
  SUCCESS_FLAG="$SUCCESS_FLAG" \
  LOCK_DIR="/tmp/infinite-buying-oci-a1-create-${region:-default}.lock" \
  "$RETRY_SCRIPT"
  rc=$?

  if [ -f "$SUCCESS_FLAG" ]; then
    log "Region attempt succeeded: ${region:-unknown}"
    exit 0
  fi

  log "Region attempt finished without instance: ${region:-unknown} exit_code=$rc"
done

if [ "$attempted" -eq 0 ]; then
  log "ERROR: no region env files were available for multi-region retry."
  exit 1
fi

exit 1
