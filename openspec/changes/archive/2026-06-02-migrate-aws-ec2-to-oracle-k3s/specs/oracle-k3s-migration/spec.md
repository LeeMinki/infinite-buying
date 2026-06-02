## ADDED Requirements

### Requirement: Oracle A1 single-node k3s shall replace AWS EC2 k3s runtime

The system SHALL run the production application on one Oracle Ampere A1 (ARM64) VM as a single-node k3s host after migration is complete, preserving the existing k3s + Argo CD + cert-manager + Traefik architecture.

#### Scenario: Oracle k3s runtime is ready

- **WHEN** the Oracle migration is completed
- **THEN** the A1 node runs single-node k3s with Argo CD, cert-manager, bundled Traefik, and the `infinite-buying` backend and frontend workloads
- **AND** the AWS EC2 k3s runtime is no longer serving production traffic
- **AND** the deployment does not claim multi-node or high-availability guarantees

#### Scenario: Backend remains a single production writer

- **WHEN** the backend workload is scheduled on the A1 cluster
- **THEN** only one backend replica runs in production
- **AND** only one backend scheduler writes trading decisions and orders

### Requirement: Continuous deploy shall continue through Argo CD GitOps

The system SHALL preserve automatic deployment after `main` updates using the existing Argo CD GitOps flow, with images built and published to GHCR.

#### Scenario: Main branch is updated

- **WHEN** a change is merged into `main`
- **THEN** GitHub Actions builds ARM64-compatible backend and frontend images
- **AND** GitHub Actions pushes the images to GHCR
- **AND** GitHub Actions commits the updated image tag into the mvp kustomization
- **AND** Argo CD syncs the change onto the A1 k3s cluster

#### Scenario: GitOps self-heal is retained

- **WHEN** the A1 k3s deployment drifts from the committed manifests
- **THEN** Argo CD reconciles the cluster back to the committed state
- **AND** deployment does not depend on SSH direct deploy or Docker Compose

### Requirement: Container registry shall use GHCR without ECR token refresh

The migrated deployment SHALL use GHCR for backend and frontend application images and SHALL remove AWS ECR, including the ECR credential refresh CronJob, from the production deployment path.

#### Scenario: Cluster pulls application images

- **WHEN** the A1 cluster deploys the application
- **THEN** workloads pull backend and frontend images from GHCR
- **AND** no production runtime step requires an AWS ECR pull secret

#### Scenario: ECR refresh job is removed from the cluster

- **WHEN** the A1 k3s deployment is active
- **THEN** the `ecr-secret-refresh` CronJob and its RBAC are not present
- **AND** if GHCR packages are private, a non-expiring pull token is injected once as an image pull secret

### Requirement: Deployment shall produce ARM-compatible images

The deployment pipeline SHALL produce container images that run on the Oracle Ampere A1 ARM64 instance.

#### Scenario: Oracle A1 node runs ARM workloads

- **WHEN** the A1 node pulls the backend and frontend images
- **THEN** the images are `linux/arm64` compatible (single-arch arm64 or multi-arch)
- **AND** the backend and frontend pods start and pass their health probes

### Requirement: k3s runtime shall provide HTTPS routing through Traefik and cert-manager

The Oracle runtime SHALL terminate HTTPS and route browser/API traffic to the correct services using the existing Traefik ingress and cert-manager certificate flow.

#### Scenario: Production HTTPS request is received

- **WHEN** a user opens `https://infinite-buying.yuna-pa.com`
- **THEN** Traefik routes `/` traffic to the frontend service and `/api` traffic to the backend service
- **AND** cert-manager issues and renews the TLS certificate via the `letsencrypt-prod` ClusterIssuer

### Requirement: Application data and secrets shall be preserved

The migration SHALL preserve SQLite application data and existing encrypted user credentials.

#### Scenario: SQLite database is restored

- **WHEN** the backend starts on the A1 node after migration
- **THEN** `/var/lib/infinite-buying/backend/app.db` exists on the A1 node
- **AND** the backend pod mounts that hostPath as its persistent data directory
- **AND** existing users, KIS settings, trading history, orders, and logs remain available

#### Scenario: Encryption secret is preserved

- **WHEN** existing KIS credentials are read after migration
- **THEN** the backend can decrypt them using the preserved `SECRET_ENCRYPTION_KEY` in `infinite-buying-secrets`
- **AND** the frontend never receives App Secret, access token, or account number plaintext

### Requirement: Oracle A1 capacity shall be validated before cutover

The migration SHALL validate that the Ampere A1 instance (target shape: 4 OCPU / 24GB RAM, Always Free maximum) can be provisioned and runs the full k3s stack before production DNS is switched.

#### Scenario: A1 instance cannot be provisioned

- **WHEN** Oracle reports insufficient capacity for the requested A1 shape
- **THEN** the migration keeps retrying the Always Free maximum shape at a later time through the retry runner
- **AND** the retry runner may try multiple subscribed OCI regions once each region has its own network/subnet env prepared
- **AND** production DNS is not switched until the A1 cluster passes smoke testing

#### Scenario: A1 cluster passes smoke testing

- **WHEN** the A1 node runs k3s with backend, frontend, Argo CD, cert-manager, and Traefik
- **THEN** all required pods remain Running during smoke testing
- **AND** the backend health endpoint remains available
- **AND** the node does not repeatedly restart pods because of memory pressure

### Requirement: DNS shall be transferred safely

The migration SHALL keep Route53 as the DNS authority and update only the production records needed to point at the A1 node.

#### Scenario: Production DNS is switched

- **WHEN** A1 smoke tests pass
- **THEN** the Route53 A record for `infinite-buying.yuna-pa.com` is updated to the A1 public IP
- **AND** `www.infinite-buying.yuna-pa.com` continues to resolve through the existing CNAME

### Requirement: Scheduler and backend writes shall not run concurrently across clouds

The migration SHALL prevent AWS and Oracle backend schedulers from both acting as production writers during cutover.

#### Scenario: Cutover is in progress

- **WHEN** the A1 backend is enabled for production testing
- **THEN** the AWS backend is stopped or scaled to zero, or the A1 backend runs with live ordering disabled, so only one scheduler places real orders
- **AND** only one backend instance writes trading decisions and orders for production users

### Requirement: AWS resources shall be cleaned up only after Oracle verification

AWS runtime resources SHALL be deleted only after Oracle production verification is complete and rollback risk is accepted.

#### Scenario: Oracle verification is complete

- **WHEN** the A1 cluster serves production traffic successfully and data integrity is verified
- **THEN** the AWS EC2 instance can be stopped and later terminated
- **AND** the AWS EBS volume, Elastic IP, ECR repositories, and unused VPC resources can be removed
- **AND** the Route53 hosted zone remains active

#### Scenario: Oracle verification fails

- **WHEN** Oracle production verification fails before AWS cleanup
- **THEN** Route53 can be pointed back to the AWS EC2 public IP and the EC2 backend restarted
- **AND** AWS EC2 remains available as the rollback runtime
