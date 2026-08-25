# PayD Kubernetes Manifests

Kustomize-based manifests for deploying PayD to a Kubernetes cluster.

## Directory Structure

```
k8s/base/
├── kustomization.yaml          # Resource list and common labels
├── backend-deployment.yaml     # Backend API deployment (2 replicas)
├── backend-service.yaml        # Backend ClusterIP service
├── backend-configmap.yaml      # Non-sensitive backend config
├── backend-secret.yaml         # Secret placeholders (never commit real values)
├── backend-hpa.yaml            # Horizontal Pod Autoscaler
├── frontend-deployment.yaml    # Frontend deployment (2 replicas)
├── frontend-service.yaml       # Frontend ClusterIP service
├── frontend-configmap.yaml     # Frontend runtime config
└── ingress.yaml                # nginx ingress with TLS
```

## Secrets Management

**`backend-secret.yaml` must never contain real secret values.** The committed file
contains `CHANGE_ME` placeholders only. Real values are injected at deploy time
using one of the methods below.

### Why this matters

The `STELLAR_SECRET_KEY` field holds a Stellar private key that controls funds on
the network. A leaked key means immediate, irreversible loss of assets. The other
fields (database credentials, JWT signing key, API keys) are equally sensitive.
Committing any of them to git — even briefly — means they live in the repository
history forever unless every clone is force-purged.

### Method 1: `kubectl create secret` (simplest, no extra tooling)

Create the secret imperatively from environment variables or a local file so that
no real value ever touches a tracked file:

```bash
# From environment variables (recommended for CI)
kubectl create secret generic payd-backend-secrets \
  --namespace payd \
  --from-literal=DATABASE_URL="$DATABASE_URL" \
  --from-literal=DB_USER="$DB_USER" \
  --from-literal=DB_PASSWORD="$DB_PASSWORD" \
  --from-literal=JWT_SECRET="$JWT_SECRET" \
  --from-literal=STELLAR_SECRET_KEY="$STELLAR_SECRET_KEY" \
  --from-literal=ANCHOR_API_KEY="$ANCHOR_API_KEY" \
  --from-literal=SDS_API_KEY="$SDS_API_KEY" \
  --dry-run=client -o yaml | kubectl apply -f -
```

Then deploy the remaining manifests without the secret file:

```bash
kubectl apply -k k8s/base/ --prune -l app=payd
```

Or exclude the secret from kustomize by removing it from `kustomization.yaml`
locally (do not commit that change).

### Method 2: Helm `--set` (if using the Helm chart)

```bash
helm install payd charts/payd \
  --namespace payd --create-namespace \
  --set backend.secrets.DATABASE_URL="$DATABASE_URL" \
  --set backend.secrets.DB_PASSWORD="$DB_PASSWORD" \
  --set backend.secrets.JWT_SECRET="$JWT_SECRET" \
  --set backend.secrets.STELLAR_SECRET_KEY="$STELLAR_SECRET_KEY" \
  --set backend.secrets.ANCHOR_API_KEY="$ANCHOR_API_KEY" \
  --set backend.secrets.SDS_API_KEY="$SDS_API_KEY"
```

### Method 3: External Secrets Operator (recommended for production)

See [External Secrets Operator](#external-secrets-operator) below.

### Method 4: CI-injected secrets

In GitHub Actions or similar CI, store secrets in the CI provider's secret store
and inject them at deploy time:

```yaml
# In your deploy step
- name: Deploy to Kubernetes
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
    JWT_SECRET: ${{ secrets.JWT_SECRET }}
    STELLAR_SECRET_KEY: ${{ secrets.STELLAR_SECRET_KEY }}
    ANCHOR_API_KEY: ${{ secrets.ANCHOR_API_KEY }}
    SDS_API_KEY: ${{ secrets.SDS_API_KEY }}
  run: |
    kubectl create secret generic payd-backend-secrets \
      --namespace payd \
      --from-literal=DATABASE_URL="$DATABASE_URL" \
      --from-literal=DB_USER="payd_user" \
      --from-literal=DB_PASSWORD="$DB_PASSWORD" \
      --from-literal=JWT_SECRET="$JWT_SECRET" \
      --from-literal=STELLAR_SECRET_KEY="$STELLAR_SECRET_KEY" \
      --from-literal=ANCHOR_API_KEY="$ANCHOR_API_KEY" \
      --from-literal=SDS_API_KEY="$SDS_API_KEY" \
      --dry-run=client -o yaml | kubectl apply -f -
```

## External Secrets Operator

For production clusters, the [External Secrets Operator (ESO)](https://external-secrets.io/)
syncs Kubernetes Secrets from an external provider (AWS Secrets Manager, HashiCorp
Vault, GCP Secret Manager, Azure Key Vault, etc.) so that no secret value is ever
stored in the git repository — not even as a placeholder that invites hand-editing.

### Why ESO over Sealed Secrets

| Criterion | External Secrets Operator | Sealed Secrets |
|---|---|---|
| Secret source | External provider (AWS SM, Vault, etc.) | Encrypted blob committed to git |
| Key rotation | Automatic via provider | Requires re-encryption with `kubeseal` |
| Access control | IAM/policies at the provider layer | Cluster-scoped sealing key |
| Audit trail | Provider-native (CloudTrail, Vault audit) | Only K8s audit logs |
| Fits existing infra | Yes — PayD already uses AWS Secrets Manager (see `infrastructure/terraform/modules/secrets/`) | Requires new Sealed Secrets controller |
| Secret updates | Automatic sync on provider change | Manual re-seal + commit |

ESO is the better fit because PayD's Terraform stack already provisions secrets in
AWS Secrets Manager. ESO bridges that into Kubernetes without introducing a second
secret store.

### Quick start (AWS Secrets Manager)

1. Install ESO in the cluster:

```bash
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  --namespace external-secrets --create-namespace
```

2. Create a `SecretStore` pointing at AWS Secrets Manager:

```yaml
# k8s/base/secret-store.yaml
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: aws-secrets-manager
  labels:
    app: payd
spec:
  provider:
    aws:
      service: SecretsManager
      region: us-east-1
      auth:
        jwt:
          serviceAccountRef:
            name: external-secrets-sa
```

3. Create an `ExternalSecret` that maps provider keys to K8s secret keys:

```yaml
# k8s/base/external-secret.yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: payd-backend-secrets
  labels:
    app: payd
    component: backend
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secrets-manager
    kind: SecretStore
  target:
    name: payd-backend-secrets
    creationPolicy: Owner
  data:
    - secretKey: DATABASE_URL
      remoteRef:
        key: payd/prod/database-url
    - secretKey: DB_USER
      remoteRef:
        key: payd/prod/db-user
    - secretKey: DB_PASSWORD
      remoteRef:
        key: payd/prod/db-password
    - secretKey: JWT_SECRET
      remoteRef:
        key: payd/prod/jwt-secret
    - secretKey: STELLAR_SECRET_KEY
      remoteRef:
        key: payd/prod/stellar-secret-key
    - secretKey: ANCHOR_API_KEY
      remoteRef:
        key: payd/prod/anchor-api-key
    - secretKey: SDS_API_KEY
      remoteRef:
        key: payd/prod/sds-api-key
```

4. Remove `backend-secret.yaml` from `kustomization.yaml` (the ExternalSecret
   creates the K8s Secret automatically).

5. Configure IRSA or static credentials for the ESO service account to read from
   AWS Secrets Manager.

## Pre-commit Safety Check

A pre-commit hook (`scripts/check-k8s-secrets.sh`) verifies that
`backend-secret.yaml` contains only the expected `CHANGE_ME` placeholders. This
runs automatically via Husky and is also enforced in CI.

To run it manually:

```bash
./scripts/check-k8s-secrets.sh
```

## Deploying

See [docs/deployment.md](../docs/deployment.md) for full deployment instructions.
