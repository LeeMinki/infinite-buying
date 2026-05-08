#!/usr/bin/env bash
set -euo pipefail

UPSTREAM="forward . 169.254.169.253 1.1.1.1 8.8.8.8"
LINK="${INFINITE_BUYING_NETWORK_LINK:-ens5}"
SEARCH_DOMAIN="${INFINITE_BUYING_DNS_SEARCH_DOMAIN:-ap-northeast-2.compute.internal}"
SWAP_SIZE="${INFINITE_BUYING_SWAP_SIZE:-2G}"

if [ "${EUID}" -ne 0 ]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
  fallocate -l "${SWAP_SIZE}" /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap -f /swapfile
  swapon /swapfile
fi

if ! grep -q '^/swapfile ' /etc/fstab; then
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

cat >/etc/netplan/99-infinite-buying-dns.yaml <<YAML
network:
  version: 2
  ethernets:
    ${LINK}:
      dhcp4: true
      dhcp4-overrides:
        use-dns: false
      nameservers:
        addresses:
          - 169.254.169.253
          - 1.1.1.1
          - 8.8.8.8
        search:
          - ${SEARCH_DOMAIN}
YAML
chmod 600 /etc/netplan/99-infinite-buying-dns.yaml

cat >/usr/local/sbin/infinite-buying-dns-guard <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail

export KUBECONFIG="/etc/rancher/k3s/k3s.yaml"
UPSTREAM="forward . 169.254.169.253 1.1.1.1 8.8.8.8"
LINK="${INFINITE_BUYING_NETWORK_LINK:-ens5}"

if command -v resolvectl >/dev/null 2>&1; then
  resolvectl dns "${LINK}" 169.254.169.253 1.1.1.1 8.8.8.8 || true
  resolvectl domain "${LINK}" ap-northeast-2.compute.internal || true
  resolvectl default-route "${LINK}" yes || true
fi

if [ -f /var/lib/rancher/k3s/server/manifests/coredns.yaml ]; then
  perl -0pi -e 's/forward \. [^\n]+/forward . 169.254.169.253 1.1.1.1 8.8.8.8/' /var/lib/rancher/k3s/server/manifests/coredns.yaml
fi

for attempt in $(seq 1 30); do
  if kubectl get configmap coredns -n kube-system >/dev/null 2>&1; then
    break
  fi
  echo "[infinite-buying] waiting for coredns configmap ($attempt/30)"
  sleep 10
done

if ! kubectl get configmap coredns -n kube-system >/dev/null 2>&1; then
  echo "[infinite-buying] coredns configmap is not available" >&2
  exit 1
fi

if kubectl get configmap coredns -n kube-system -o jsonpath='{.data.Corefile}' | grep -Fq "$UPSTREAM"; then
  echo "[infinite-buying] DNS guard ok"
  exit 0
fi

kubectl get configmap coredns -n kube-system -o json \
  | jq --arg upstream "$UPSTREAM" '.data.Corefile |= sub("forward \\. [^\\n]+"; $upstream)' \
  | kubectl apply -f -

kubectl rollout restart deployment/coredns -n kube-system
kubectl rollout status deployment/coredns -n kube-system --timeout=180s
SCRIPT
chmod 0755 /usr/local/sbin/infinite-buying-dns-guard

cat >/etc/systemd/system/infinite-buying-dns-guard.service <<'UNIT'
[Unit]
Description=Infinite Buying DNS loop guard
Requires=k3s.service systemd-resolved.service
After=k3s.service systemd-resolved.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/infinite-buying-dns-guard
UNIT

cat >/etc/systemd/system/infinite-buying-dns-guard.timer <<'UNIT'
[Unit]
Description=Run Infinite Buying DNS loop guard periodically

[Timer]
OnBootSec=1min
OnUnitActiveSec=5min
AccuracySec=30s
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl disable study-note-coredns-upstream.service >/dev/null 2>&1 || true
netplan generate
netplan apply
systemctl enable --now infinite-buying-dns-guard.timer
systemctl start infinite-buying-dns-guard.service

swapon --show
systemctl status infinite-buying-dns-guard.service --no-pager -l
