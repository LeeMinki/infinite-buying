## 1. Pre-Migration Inventory

- [x] 1.1 Export current EC2 runtime inventory: deployed image tags, `infinite-buying-secrets` keys, ingress hosts, cert-manager certificate state, k3s/Argo CD/cert-manager versions, and backend data path.
- [x] 1.2 Record the current Argo CD Application and cluster add-on install method (k3s, Argo CD, cert-manager, `letsencrypt-prod` ClusterIssuer) so the same setup can be reproduced on the A1 node.
- [x] 1.3 Record current Route53 records for `infinite-buying.yuna-pa.com` and `www.infinite-buying.yuna-pa.com`.
- [x] 1.4 Prepare GHCR credentials and document required GitHub Actions secrets/permissions and the cluster pull-secret approach (public package or private pull token).

## 2. OCI Network and A1 VM Setup

- [x] 2.1 Verify OCI CLI authentication and confirm target region, compartment, and availability domain from current OCI config.
- [x] 2.2 Create OCI VCN, public subnet, internet gateway, route table, and security list or NSG because no reusable VCN is available.
- [x] 2.3 Configure OCI network rules for SSH (22, restricted source), HTTP (80), and HTTPS (443); do not expose the k3s API (6443) publicly unless required.
- [x] 2.4 Provision one Ampere A1 (ARM64) Ubuntu instance with 4 OCPU / 24GB RAM (Always Free max) and record its public/private IPs; run the OCI region env bootstrap and multi-region retry scripts on a cron to retry subscribed regions until host capacity is available.
- [x] 2.5 Configure swap and verify memory headroom for k3s, Argo CD, cert-manager, Traefik, backend, and frontend.

## 3. k3s Cluster Bring-up

- [x] 3.1 Install single-server k3s on the A1 node (bundled Traefik and ServiceLB).
- [x] 3.2 Create the hostPath data directory `/var/lib/infinite-buying/backend` with correct ownership.
- [x] 3.3 Install Argo CD and register the `infra/kubernetes/argocd/applications/infinite-buying-mvp.yaml` Application against this repo.
- [x] 3.4 Install cert-manager and create the `letsencrypt-prod` ClusterIssuer.

## 4. GHCR, ARM64 Build, and Manifest Migration

- [x] 4.1 Update GitHub Actions to remove AWS credential configuration, ECR login, ECR repository creation, and ECR push; remove the AWS OIDC `id-token` permission.
- [x] 4.2 Add GHCR login and the `packages: write` permission; push backend/frontend images to GHCR.
- [x] 4.3 Add `linux/arm64` (or multi-arch) build via buildx + QEMU or an ARM runner for backend and frontend.
- [x] 4.4 Update the GitOps tag-commit step to write GHCR `newName` values into `overlays/mvp/kustomization.yaml`.
- [x] 4.5 Update `overlays/mvp/kustomization.yaml` image `name`/`newName` to the GHCR coordinates.
- [x] 4.6 Remove ECR `imagePullSecrets` from backend/frontend Deployments (public package) or replace with a GHCR pull secret (private package).
- [x] 4.7 Remove `ecr-refresh-cronjob.yaml` and `ecr-refresh-rbac.yaml` from the base kustomization.

## 5. Secrets, Data Restore, and Smoke Test

- [x] 5.1 Recreate `infinite-buying-secrets` on the A1 cluster with the preserved `SECRET_ENCRYPTION_KEY`, `SESSION_SECRET`, and KIS values; create a GHCR pull secret if the package is private.
- [x] 5.2 With the A1 backend held at `ENABLE_LIVE_ORDER=false`, stop the EC2 backend (`replicas: 0`), back up `app.db` with `sqlite3 .backup`, and record checksum/size/timestamp.
- [x] 5.3 Restore the backed-up `app.db` to the A1 node at `/var/lib/infinite-buying/backend/app.db` and verify checksum.
- [x] 5.4 Confirm Argo CD syncs the Application and all pods are Running on the A1 cluster.
- [x] 5.5 Verify backend `/api/health`, login, KIS settings metadata, backtest page, auto-trading page, and recent order/log data.
- [x] 5.6 Confirm only one production backend scheduler is active (EC2 backend down) before live traffic cutover.

## 6. DNS Cutover and Verification

- [x] 6.1 Update Route53 `infinite-buying.yuna-pa.com` A record from the AWS EC2 IP to the A1 public IP.
- [x] 6.2 Verify `www.infinite-buying.yuna-pa.com` still resolves through the existing CNAME.
- [x] 6.3 Verify cert-manager issues the TLS certificate (HTTP-01) and Traefik serves HTTPS.
- [x] 6.4 Switch the A1 backend `ENABLE_LIVE_ORDER` to the production value and re-confirm the EC2 backend stays down.
- [x] 6.5 Verify production HTTPS traffic reaches the A1 frontend/backend.
- [x] 6.6 Monitor pod status, cert-manager/Traefik, backend logs, scheduler logs, KIS token issuance, and user-facing pages after cutover.

## 7. Rollback and AWS Cleanup

- [x] 7.1 Keep AWS EC2 and EBS available until Oracle production verification is complete.
- [x] 7.2 Document rollback steps to point Route53 back to `3.39.3.103` and restart the EC2 backend.
- [x] 7.3 After verification, stop AWS EC2 and confirm production remains healthy on the A1 cluster.
- [x] 7.4 Terminate AWS EC2, delete EBS, release Elastic IP, and remove unused VPC resources after final backup is retained.
- [x] 7.5 Delete ECR repositories or apply lifecycle cleanup after confirming GHCR deployment is stable.
- [x] 7.6 Confirm only the Route53 hosted zone remains as the intended AWS runtime cost.
