## Implementation Notes

### 2026-06-02 Inventory

Current AWS runtime:

- Host: `study-note-mvp-node` / `3.39.3.103`
- OS: Ubuntu 22.04.5 LTS
- Instance class observed from AWS inventory: `t3.small`
- Memory observed on EC2: 1.9GiB total, 1.4GiB used, 276MiB available, 2.0GiB swap with 759MiB used
- Root volume: 30GiB, 82% used
- k3s node: single control-plane, `v1.34.6+k3s1`
- Container runtime: containerd
- Namespaces: `argocd`, `cert-manager`, `infinite-buying`, `kube-system`

Current add-ons and workloads:

- Argo CD: `quay.io/argoproj/argocd:v3.3.6`
- cert-manager: `quay.io/jetstack/*:v1.20.2`
- k3s bundled Traefik: `rancher/mirrored-library-traefik:3.6.10`
- Backend image: `107015853205.dkr.ecr.ap-northeast-2.amazonaws.com/infinite-buying-backend:0b123dd07e856f1d99b1b1e68be77628cd92ddfe`
- Frontend image: `107015853205.dkr.ecr.ap-northeast-2.amazonaws.com/infinite-buying-frontend:0b123dd07e856f1d99b1b1e68be77628cd92ddfe`
- Backend data mount: hostPath `/var/lib/infinite-buying/backend` mounted at `/var/lib/infinite-buying/backend`
- Backend secret keys present in `infinite-buying-secrets`: `SECRET_ENCRYPTION_KEY`, `SESSION_SECRET`
- cert-manager certificate `infinite-buying-tls-secret`: Ready
- ClusterIssuers: `letsencrypt-prod`, `letsencrypt-staging`

Current Argo CD Application:

- Name: `infinite-buying-mvp`
- Source repo: `https://github.com/LeeMinki/infinite-buying.git`
- Target revision: `main`
- Path: `infra/kubernetes/infinite-buying/overlays/mvp`
- Destination namespace: `infinite-buying`
- Sync policy: automated prune + self-heal, `CreateNamespace=true`
- Current sync status: Synced
- Current health: Healthy
- Current revision: `6cdf6de96e5a7bfc3c478ca77f428a3885ff19d8`

Current Route53 records:

- Hosted zone: `yuna-pa.com`
- `infinite-buying.yuna-pa.com.`: A, TTL 300, `3.39.3.103`
- `www.infinite-buying.yuna-pa.com.`: CNAME, TTL 300, `infinite-buying.yuna-pa.com`

GitHub/GHCR readiness:

- Repository: `LeeMinki/infinite-buying`
- Repository visibility: public
- Current GitHub viewer permission: ADMIN
- GHCR approach selected for this migration: publish application packages publicly, so the Oracle k3s cluster does not need a GHCR pull secret.
- GitHub Actions must use `packages: write` for GHCR push.

OCI readiness:

- OCI CLI authentication works.
- Active target region and availability domain are read from the current OCI config at apply time.
- Target tenancy/root compartment currently has no reusable compute instance or VCN from the earlier read-only inventory.
- A1 OCPU and memory quota showed zero usage during inventory, but actual Always Free capacity is validated only when launching the A1 instance.

### 2026-06-02 OCI Network Bootstrap

Created OCI network resources for the migration:

- VCN: `infinite-buying-vcn`, CIDR `10.0.0.0/16`, state `AVAILABLE`
- Public subnet: `infinite-buying-public-subnet`, CIDR `10.0.1.0/24`
- Internet gateway: `infinite-buying-igw`
- Route table: `infinite-buying-public-rt`, default route to internet gateway
- Security list: `infinite-buying-public-sl`
  - SSH 22/tcp restricted to the current operator public IP at creation time
  - HTTP 80/tcp open to public
  - HTTPS 443/tcp open to public
  - All outbound allowed

### 2026-06-02 A1 Provisioning Attempts

Tried to create an Ampere A1 Ubuntu ARM64 instance using the existing SSH public key.

Attempted shapes:

- 2 OCPU / 12GB RAM: failed, `Out of host capacity`
- 2 OCPU / 8GB RAM: failed, `Out of host capacity`
- 1 OCPU / 6GB RAM: failed, `TooManyRequests` after repeated launch attempts
- 1 OCPU / 4GB RAM: failed, `Out of host capacity`

No OCI Compute instance was created. Migration is blocked at VM provisioning until A1 capacity is available or a different shape/region strategy is chosen.

### 2026-06-02 A1 Retry Analysis

Retried VM provisioning after confirming the OCI network bootstrap is intact.

Pre-checks before retry:

- Compute instance list: empty
- Boot volume list: empty
- VNIC attachment list: empty
- A1 OCPU quota usage: 0 used, quota available
- A1 memory quota usage: 0 used, quota available
- Ubuntu ARM64 image for `VM.Standard.A1.Flex`: found

Retry results:

- 2 OCPU / 12GB RAM: failed again with `Out of host capacity`
- 1 OCPU / 4GB RAM: blocked by `TooManyRequests` after repeated launch attempts

Post-checks:

- No Compute instance was created
- A1 OCPU and memory quota still show zero usage
- Recent LaunchInstance work requests remain `ACCEPTED` with no attached resources, no work-request errors, and no work-request logs

Conclusion:

- OCI CLI authentication, compartment, image lookup, subnet, security list, and quota are not the current blocker.
- The practical blocker is Oracle A1 host capacity in the currently configured region/availability domain.
- The `TooManyRequests` response is secondary and caused by repeated launch attempts; retrying immediately can hit request throttling before a new capacity check completes.
- Task 2.4 remains incomplete. Do not switch DNS or stop AWS runtime until an A1 VM is successfully provisioned and smoke-tested.

### 2026-06-02 Seoul Region Subscription Attempt

Tried to switch the migration target from the currently subscribed OCI region to Seoul and create the A1 VM there.

Findings:

- Current OCI config points to the existing subscribed home region.
- `iam region-subscription list` shows only one subscribed region and no Seoul subscription.
- Attempting to subscribe Seoul failed with `TenantCapacityExceeded`: the tenancy has already reached the maximum number of subscribed regions.

Conclusion:

- Seoul cannot be used from this tenancy until OCI allows another subscribed region or the tenancy/account is changed.
- Existing regional network resources cannot be "moved" from one OCI region to another; they would need to be recreated in Seoul after Seoul subscription succeeds.
- The migration remains blocked at task 2.4. The safe options are to retry A1 capacity in the current subscribed region, request/obtain another region subscription, or use a different tenancy/account/paid shape.

### 2026-06-02 A1 Capacity Retry Script

Added `infra/operations/try-create-oci-a1.sh` to keep retrying A1 provisioning in the currently configured OCI region.

Script behavior:

- Reads OCI resource IDs from `openspec/changes/migrate-aws-ec2-to-oracle-k3s/oci-resources.env`
- Uses `VM.Standard.A1.Flex`
- Defaults to the Always Free maximum shape: 4 OCPU / 24GB RAM
- Uses a 100GB boot volume
- Dynamically selects the latest Ubuntu 22.04 ARM image for A1
- Avoids duplicate creation if an instance with the target display name already exists
- Writes logs to `$HOME/oci-a1-create.log`
- Stops future attempts after success by creating `$HOME/.oci-a1-created`
- Records created instance/VNIC/public/private IP values back into `oci-resources.env`
- Optionally sends a Telegram notification if token/chat ID environment variables are set

Initial local test:

- Ran the retry script once from the local workstation.
- The local workstation cron was later removed so only the EC2 runner keeps retrying.

Immediate test result:

- 4 OCPU / 24GB launch attempted
- Failed with `Out of host capacity`
- No Compute instance was created

Task 2.4 remains incomplete until the retry script successfully creates the A1 VM and the public/private IPs are recorded.

### 2026-06-02 EC2 Retry Runner

Moved the A1 retry runner to the current AWS EC2 host so it can keep running while the local workstation is offline.

EC2 setup:

- Installed OCI CLI under the EC2 user's home directory
- Copied OCI config/API key to the EC2 user's private `.oci` directory
- Copied `try-create-oci-a1.sh`, `oci-resources.env`, and the SSH public key to an EC2-local retry directory
- Created an EC2-local private environment file for runtime-only values
- Configured Telegram notification values in that private environment file, not in git-tracked files
- Verified OCI CLI authentication from EC2
- Sent a Telegram setup test message successfully

Cron:

- EC2 runs the retry script every minute
- The script lock prevents overlapping launch attempts when a previous OCI launch request is still waiting
- The earlier local workstation cron was removed to avoid duplicate retries

Current EC2 retry result:

- The script is running with 4 OCPU / 24GB RAM
- OCI still returns `Out of host capacity`
- No Compute instance has been created yet

### 2026-06-02 EC2 Heartbeat Update

Updated the EC2 retry runner with Telegram heartbeat support.

Behavior:

- Cron still starts every minute.
- The script lock prevents overlap while an OCI launch request is already waiting.
- Heartbeat interval is 30 minutes.
- Heartbeat message summarizes the recent 30-minute retry window:
  - number of failed launch attempts
  - last failure reason
  - requested shape
  - host name
- Success notification remains immediate and includes the created instance/public IP when available.

Validation:

- Sent a manual Telegram message before applying the new script.
- Replaced the EC2 script with the heartbeat-capable local version.
- Initialized heartbeat state at apply time so the first heartbeat window starts cleanly.
- Confirmed a new failed OCI launch increments the attempt counter and stores `Out of host capacity` as the last error.

### 2026-06-02 Target Shape and Heartbeat

- Target A1 shape is fixed at the Always Free maximum: 4 OCPU / 24GB RAM.
- The retry script defaults to `OCPUS=4` / `MEMORY_GB=24`.
- The EC2 runner starts every minute, but the script lock prevents overlapping launch attempts.
- Heartbeat interval is 30 minutes (`HEARTBEAT_INTERVAL=1800`).
- Capacity/launch failures increment a windowed attempt counter and store the last error reason.
- Heartbeat messages summarize the recent 30-minute window instead of sending a Telegram message every minute.
- Success still sends an immediate one-off Telegram message.
- Last heartbeat time, attempt count, and last error are persisted in files because each cron run is a fresh process.

### 2026-06-02 Multi-Region Retry Update

The tenancy now shows three subscribed regions:

- South Korea Central (Seoul)
- Japan East (Tokyo)
- South Korea North (Chuncheon, home region)

Updated the retry tooling so it can use more than the home region:

- `try-create-oci-a1.sh` now honors `OCI_REGION` from the selected resource env file and passes it explicitly to OCI CLI calls.
- `try-create-oci-a1-all-regions.sh` loops over region-specific env files and tries A1 launch in order.
- `ensure-oci-a1-region-envs.sh` prepares region-specific VCN/subnet/security list env files when OCI API authentication works in that region.
- The EC2 cron now runs `ensure-oci-a1-region-envs.sh` first and then runs `try-create-oci-a1-all-regions.sh`.
- `TARGET_REGIONS` on EC2 is set to Seoul, Tokyo, and Chuncheon.

Current state:

- Region subscription list shows Seoul and Tokyo as `READY`.
- OCI API calls in Seoul currently return `NotAuthenticated` during availability domain lookup.
- OCI API calls in Tokyo can reach some early calls, but VCN creation currently returns `NotAuthenticated`.
- This likely means new region IAM/API key propagation is not fully usable yet from the current CLI credentials.
- The bootstrap script validates each required OCID before writing a region env file, so partial/empty regional env files are not retained.
- Until Seoul/Tokyo authentication and network bootstrap succeed, the retry wrapper skips those missing regional env files and continues using the existing Chuncheon env.
- Once authentication works, the EC2 cron will create the Seoul/Tokyo network env files and include them in subsequent A1 launch attempts without another manual script change.

### 2026-06-02 A1 Instance Created

The EC2 retry runner successfully created an Ampere A1 instance in Tokyo.

Result:

- Shape: 4 OCPU / 24GB RAM
- State: RUNNING
- Public IP and private IP were recorded in the EC2-local Tokyo resource env file
- Success flag was created, so future cron executions exit without creating another instance

Follow-up:

- Corrected the EC2 resource env file because OCI CLI wait output was mixed into the stored instance ID.
- Updated `try-create-oci-a1.sh` to extract only the `ocid1.instance...` value from OCI CLI output before writing runtime env state.
- Do not switch DNS or stop AWS yet. The next migration step is k3s/swap/bootstrap on the new A1 node, then GHCR/Argo CD/data/secret migration and smoke testing.

### 2026-06-02 A1 k3s Bootstrap

Bootstrapped the Tokyo A1 instance as the target single-node runtime.

Observed node state:

- Host: `infinite-buying-a1-k3s`
- Shape: 4 OCPU / 24GB RAM
- OS: Ubuntu 22.04 ARM64
- Runtime architecture: `aarch64`
- k3s: `v1.35.5+k3s1`
- Public IP: recorded in the private OCI resource env
- Private IP: recorded in the private OCI resource env

Node preparation:

- Configured a 4GB swap file and `vm.swappiness=10`.
- Created `/var/lib/infinite-buying/backend` for the backend hostPath SQLite directory.
- Verified memory headroom after k3s, Argo CD, cert-manager, Traefik, and system pods were running: roughly 21GB available, swap unused.

Cluster bootstrap:

- Installed single-server k3s with bundled Traefik and ServiceLB.
- Installed Argo CD in the `argocd` namespace.
- Installed cert-manager in the `cert-manager` namespace.
- Created `letsencrypt-staging` and `letsencrypt-prod` ClusterIssuers using the existing maintainer email.
- Verified k3s node Ready and cluster add-on pods Running.

The Argo CD Application is intentionally not registered yet because current committed manifests still point at the pre-migration image state until the GHCR/ARM64 workflow change is merged and GHCR images are available.

### 2026-06-02 GHCR Manifest and Workflow Preparation

Prepared the repository for GHCR and ARM-compatible deployment.

Code changes:

- GitHub Actions no longer configures AWS credentials, ECR login, ECR repository creation, or ECR push.
- GitHub Actions now has `packages: write`, logs in to GHCR, and uses buildx/QEMU.
- Backend and frontend images are configured as multi-arch `linux/amd64,linux/arm64` images.
- The GitOps image tag commit step now writes GHCR image coordinates.
- The mvp overlay points at `ghcr.io/leeminki/infinite-buying-backend` and `ghcr.io/leeminki/infinite-buying-frontend`.
- Backend/frontend Deployments no longer reference the ECR pull secret.
- The base kustomization no longer includes the ECR refresh CronJob/RBAC.

Validation:

- Rendered the local mvp overlay through the A1 node's k3s kubectl.
- Confirmed rendered images are GHCR images.
- Confirmed no rendered `imagePullSecrets` or ECR image references remain in the application manifests.

GHCR image push is still pending the merge/build workflow run. The A1 Argo CD Application, production secrets, SQLite restore, and DNS cutover remain intentionally pending until that workflow succeeds.

### 2026-06-02 A1 Application Sync and DNS Cutover

After GHCR image publishing succeeded, the A1 cluster was promoted toward production.

Completed steps:

- Recreated `infinite-buying-secrets` on the A1 cluster from the EC2 cluster without printing secret values.
- Scaled the EC2 backend deployment to zero before the final DB backup to prevent scheduler duplication and data divergence.
- Created a SQLite `.backup` file from the EC2 hostPath DB.
- Restored the backup to the A1 hostPath DB and verified the restored file checksum.
- Registered the Argo CD `infinite-buying-mvp` Application on the A1 cluster.
- Confirmed the Application reached `Synced/Healthy` and backend/frontend pods were Running.
- Verified HTTP `/api/health` through the A1 public IP with the production Host header.
- Updated Route53 `infinite-buying.yuna-pa.com` A record from the AWS EC2 public IP to the A1 public IP.
- Confirmed `www.infinite-buying.yuna-pa.com` still resolves through the existing CNAME.

TLS note:

- During cert-manager HTTP-01 validation, the hostless `infinite-buying-ip-fallback` ingress routed ACME challenge paths to the frontend.
- The fallback ingress is no longer needed after DNS cutover and was removed from the base kustomization.
- The fallback ingress was also deleted from the A1 cluster so cert-manager can route challenge paths to the solver pods.
