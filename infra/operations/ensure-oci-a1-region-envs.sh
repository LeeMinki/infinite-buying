#!/usr/bin/env bash
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEFAULT_BASE_ENV_FILE="$REPO_ROOT/openspec/changes/migrate-aws-ec2-to-oracle-k3s/oci-resources.env"

OCI_BIN="${OCI_BIN:-}"
BASE_ENV_FILE="${BASE_ENV_FILE:-${ENV_FILE:-$DEFAULT_BASE_ENV_FILE}}"
ENV_DIR="${ENV_DIR:-$(dirname "$BASE_ENV_FILE")}"
LOG_FILE="${LOG_FILE:-$HOME/oci-a1-create.log}"
TARGET_REGIONS="${TARGET_REGIONS:-ap-seoul-1 ap-tokyo-1 ap-chuncheon-1}"
VCN_CIDR="${VCN_CIDR:-10.0.0.0/16}"
SUBNET_CIDR="${SUBNET_CIDR:-10.0.1.0/24}"
SSH_SOURCE_CIDR="${SSH_SOURCE_CIDR:-}"

log() {
  printf '%s: %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$*" >> "$LOG_FILE"
}

fail() {
  log "ERROR: $*"
  exit 1
}

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
[ -f "$BASE_ENV_FILE" ] || fail "Base OCI resource env file not found: $BASE_ENV_FILE"
mkdir -p "$ENV_DIR"

set -a
# shellcheck disable=SC1090
. "$BASE_ENV_FILE"
set +a

: "${OCI_COMPARTMENT_ID:?missing OCI_COMPARTMENT_ID in base env file}"

if [ -z "$SSH_SOURCE_CIDR" ]; then
  if [ -n "${OPERATOR_PUBLIC_IP:-}" ]; then
    SSH_SOURCE_CIDR="${OPERATOR_PUBLIC_IP}/32"
  else
    SSH_SOURCE_CIDR="0.0.0.0/0"
  fi
fi

first_id() {
  "$@" --query 'data[0].id' --raw-output 2>>"$LOG_FILE" || true
}

is_ocid() {
  case "${1:-}" in
    ocid1.*) return 0 ;;
    *) return 1 ;;
  esac
}

for region in $TARGET_REGIONS; do
  env_file="$ENV_DIR/oci-resources-${region}.env"
  if [ -f "$env_file" ] && grep -q '^OCI_SUBNET_ID=' "$env_file"; then
    log "Region env already exists: $region $env_file"
    continue
  fi

  log "Ensuring OCI network resources for region: $region"

  availability_domain="$("$OCI_BIN" --region "$region" iam availability-domain list \
    --compartment-id "$OCI_COMPARTMENT_ID" \
    --query 'data[0].name' \
    --raw-output 2>>"$LOG_FILE" || true)"

  if [ -z "$availability_domain" ] || [ "$availability_domain" = "null" ]; then
    log "Skipping region $region: availability domain lookup failed. New region subscription or IAM replication may still be pending."
    continue
  fi

  vcn_id="$(first_id "$OCI_BIN" --region "$region" network vcn list \
    --compartment-id "$OCI_COMPARTMENT_ID" \
    --display-name infinite-buying-vcn \
    --lifecycle-state AVAILABLE)"

  if [ -z "$vcn_id" ] || [ "$vcn_id" = "null" ]; then
    vcn_id="$("$OCI_BIN" --region "$region" network vcn create \
      --compartment-id "$OCI_COMPARTMENT_ID" \
      --cidr-block "$VCN_CIDR" \
      --display-name infinite-buying-vcn \
      --wait-for-state AVAILABLE \
      --query 'data.id' \
      --raw-output 2>>"$LOG_FILE")"
  fi
  if ! is_ocid "$vcn_id"; then
    log "Skipping region $region: VCN lookup/create failed."
    continue
  fi

  igw_id="$(first_id "$OCI_BIN" --region "$region" network internet-gateway list \
    --compartment-id "$OCI_COMPARTMENT_ID" \
    --vcn-id "$vcn_id" \
    --display-name infinite-buying-igw \
    --lifecycle-state AVAILABLE)"

  if [ -z "$igw_id" ] || [ "$igw_id" = "null" ]; then
    igw_id="$("$OCI_BIN" --region "$region" network internet-gateway create \
      --compartment-id "$OCI_COMPARTMENT_ID" \
      --vcn-id "$vcn_id" \
      --is-enabled true \
      --display-name infinite-buying-igw \
      --wait-for-state AVAILABLE \
      --query 'data.id' \
      --raw-output 2>>"$LOG_FILE")"
  fi
  if ! is_ocid "$igw_id"; then
    log "Skipping region $region: internet gateway lookup/create failed."
    continue
  fi

  route_table_id="$(first_id "$OCI_BIN" --region "$region" network route-table list \
    --compartment-id "$OCI_COMPARTMENT_ID" \
    --vcn-id "$vcn_id" \
    --display-name infinite-buying-public-rt \
    --lifecycle-state AVAILABLE)"

  if [ -z "$route_table_id" ] || [ "$route_table_id" = "null" ]; then
    route_table_id="$("$OCI_BIN" --region "$region" network route-table create \
      --compartment-id "$OCI_COMPARTMENT_ID" \
      --vcn-id "$vcn_id" \
      --display-name infinite-buying-public-rt \
      --route-rules "[{\"destination\":\"0.0.0.0/0\",\"destinationType\":\"CIDR_BLOCK\",\"networkEntityId\":\"$igw_id\"}]" \
      --wait-for-state AVAILABLE \
      --query 'data.id' \
      --raw-output 2>>"$LOG_FILE")"
  fi
  if ! is_ocid "$route_table_id"; then
    log "Skipping region $region: route table lookup/create failed."
    continue
  fi

  security_list_id="$(first_id "$OCI_BIN" --region "$region" network security-list list \
    --compartment-id "$OCI_COMPARTMENT_ID" \
    --vcn-id "$vcn_id" \
    --display-name infinite-buying-public-sl \
    --lifecycle-state AVAILABLE)"

  if [ -z "$security_list_id" ] || [ "$security_list_id" = "null" ]; then
    ingress_rules="[
      {\"protocol\":\"6\",\"source\":\"$SSH_SOURCE_CIDR\",\"tcpOptions\":{\"destinationPortRange\":{\"min\":22,\"max\":22}}},
      {\"protocol\":\"6\",\"source\":\"0.0.0.0/0\",\"tcpOptions\":{\"destinationPortRange\":{\"min\":80,\"max\":80}}},
      {\"protocol\":\"6\",\"source\":\"0.0.0.0/0\",\"tcpOptions\":{\"destinationPortRange\":{\"min\":443,\"max\":443}}}
    ]"
    egress_rules='[{"protocol":"all","destination":"0.0.0.0/0"}]'
    security_list_id="$("$OCI_BIN" --region "$region" network security-list create \
      --compartment-id "$OCI_COMPARTMENT_ID" \
      --vcn-id "$vcn_id" \
      --display-name infinite-buying-public-sl \
      --ingress-security-rules "$ingress_rules" \
      --egress-security-rules "$egress_rules" \
      --wait-for-state AVAILABLE \
      --query 'data.id' \
      --raw-output 2>>"$LOG_FILE")"
  fi
  if ! is_ocid "$security_list_id"; then
    log "Skipping region $region: security list lookup/create failed."
    continue
  fi

  subnet_id="$(first_id "$OCI_BIN" --region "$region" network subnet list \
    --compartment-id "$OCI_COMPARTMENT_ID" \
    --vcn-id "$vcn_id" \
    --display-name infinite-buying-public-subnet \
    --lifecycle-state AVAILABLE)"

  if [ -z "$subnet_id" ] || [ "$subnet_id" = "null" ]; then
    subnet_id="$("$OCI_BIN" --region "$region" network subnet create \
      --compartment-id "$OCI_COMPARTMENT_ID" \
      --vcn-id "$vcn_id" \
      --cidr-block "$SUBNET_CIDR" \
      --display-name infinite-buying-public-subnet \
      --route-table-id "$route_table_id" \
      --security-list-ids "[\"$security_list_id\"]" \
      --prohibit-public-ip-on-vnic false \
      --wait-for-state AVAILABLE \
      --query 'data.id' \
      --raw-output 2>>"$LOG_FILE")"
  fi
  if ! is_ocid "$subnet_id"; then
    log "Skipping region $region: subnet lookup/create failed."
    continue
  fi

  {
    printf 'OCI_REGION=%s\n' "$region"
    printf 'OCI_COMPARTMENT_ID=%s\n' "$OCI_COMPARTMENT_ID"
    printf 'OCI_AVAILABILITY_DOMAIN=%s\n' "$availability_domain"
    [ -n "${OPERATOR_PUBLIC_IP:-}" ] && printf 'OPERATOR_PUBLIC_IP=%s\n' "$OPERATOR_PUBLIC_IP"
    printf 'OCI_VCN_ID=%s\n' "$vcn_id"
    printf 'OCI_INTERNET_GATEWAY_ID=%s\n' "$igw_id"
    printf 'OCI_ROUTE_TABLE_ID=%s\n' "$route_table_id"
    printf 'OCI_SECURITY_LIST_ID=%s\n' "$security_list_id"
    printf 'OCI_SUBNET_ID=%s\n' "$subnet_id"
  } > "$env_file"

  chmod 600 "$env_file" 2>/dev/null || true
  log "Region env created: $region $env_file"
done
