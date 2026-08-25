# PayD Kubernetes Deployment Guide

This guide covers deploying PayD to a Kubernetes cluster using either raw manifests or the Helm chart.

## Prerequisites

- Kubernetes cluster (v1.25+)
- kubectl configured and connected to your cluster
- Helm v3.10+ (if using Helm chart)
- External PostgreSQL database (not in-cluster)
- External Redis instance (not in-cluster)
- Container registry with PayD images
- Ingress controller installed (nginx-ingress recommended)
- cert-manager (optional, for automatic TLS)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Kubernetes Cluster                        │
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │   Ingress   │────│  Frontend   │    │   Backend   │     │
│  │  Controller │    │  (React)    │────│   (API)     │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
│         │                                    │              │
│         │                                    │              │
│         ▼                                    ▼              │
│  ┌─────────────┐                    ┌─────────────┐        │
│  │   External  │                    │   External  │        │
│  │  PostgreSQL │                    │    Redis    │        │
│  └─────────────┘                    └─────────────┘        │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Stellar Network                        │   │
│  │  (Horizon, Soroban RPC)                             │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Option 1: Using Raw Manifests

### 1. Create Secrets

**Do not edit `k8s/base/backend-secret.yaml` with real values.** That file is
tracked by git and must only contain placeholders. Instead, create the secret
imperatively:

```bash
kubectl create secret generic payd-backend-secrets \
  --namespace payd \
  --from-literal=DATABASE_URL="postgresql://user:password@your-db-host:5432/payd_db" \
  --from-literal=DB_USER="your_db_user" \
  --from-literal=DB_PASSWORD="your_db_password" \
  --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
  --from-literal=STELLAR_SECRET_KEY="your_stellar_secret_key" \
  --from-literal=ANCHOR_API_KEY="your_anchor_api_key" \
  --from-literal=SDS_API_KEY="your_sds_api_key" \
  --dry-run=client -o yaml | kubectl apply -f -
```

For production, use the External Secrets Operator to sync from AWS Secrets
Manager. See [k8s/README.md](../k8s/README.md) for details.

### 2. Update ConfigMap

Edit `k8s/base/backend-configmap.yaml` if needed:

```yaml
data:
  DB_HOST: "your-db-host"
  REDIS_URL: "redis://your-redis-host:6379"
```

### 3. Update Ingress

Edit `k8s/base/ingress.yaml` with your domain:

```yaml
spec:
  tls:
    - hosts:
        - payd.yourdomain.com
        - api.payd.yourdomain.com
      secretName: payd-tls
  rules:
    - host: payd.yourdomain.com
    - host: api.payd.yourdomain.com
```

### 4. Build and Push Docker Images

```bash
# Build backend
cd backend
docker build -t your-registry/payd-backend:latest .
docker push your-registry/payd-backend:latest

# Build frontend
cd frontend
docker build -t your-registry/payd-frontend:latest .
docker push your-registry/payd-frontend:latest
```

### 5. Update Image References

Edit the deployment files to use your registry:

```yaml
# k8s/base/backend-deployment.yaml
containers:
  - name: backend
    image: your-registry/payd-backend:latest

# k8s/base/frontend-deployment.yaml
containers:
  - name: frontend
    image: your-registry/payd-frontend:latest
```

### 6. Deploy

```bash
kubectl apply -k k8s/base/
```

### 7. Verify Deployment

```bash
kubectl get pods -l app=payd
kubectl get services -l app=payd
kubectl get ingress payd-ingress
```

## Option 2: Using Helm Chart

### 1. Configure Values

Create a custom values file or edit `charts/payd/values.yaml`:

```yaml
# my-values.yaml
global:
  imageRegistry: "your-registry/"

backend:
  image:
    tag: "latest"
  secrets:
    DATABASE_URL: "postgresql://user:password@your-db-host:5432/payd_db"
    DB_USER: "your_db_user"
    DB_PASSWORD: "your_db_password"
    JWT_SECRET: "your_secure_jwt_secret"
    STELLAR_SECRET_KEY: "your_stellar_secret_key"
    ANCHOR_API_KEY: "your_anchor_api_key"
    SDS_API_KEY: "your_sds_api_key"

frontend:
  config:
    VITE_API_URL: "https://api.payd.yourdomain.com"

ingress:
  hosts:
    - host: payd.yourdomain.com
      paths:
        - path: /
          pathType: Prefix
          service: frontend
          port: 80
    - host: api.payd.yourdomain.com
      paths:
        - path: /
          pathType: Prefix
          service: backend
          port: 3001
  tls:
    - secretName: payd-tls
      hosts:
        - payd.yourdomain.com
        - api.payd.yourdomain.com

stellar:
  network: "TESTNET"
  horizonUrl: "https://horizon-testnet.stellar.org"
```

### 2. Install Chart

```bash
# Install to a namespace
helm install payd charts/payd \
  --namespace payd \
  --create-namespace \
  -f my-values.yaml

# Or use production values
helm install payd charts/payd \
  --namespace payd \
  --create-namespace \
  -f charts/payd/values-production.yaml
```

### 3. Upgrade Chart

```bash
helm upgrade payd charts/payd \
  --namespace payd \
  -f my-values.yaml
```

### 4. Uninstall Chart

```bash
helm uninstall payd --namespace payd
```

### 5. Verify Installation

```bash
helm status payd --namespace payd
kubectl get pods -n payd
kubectl get services -n payd
```

## TLS Configuration

### Using cert-manager (Recommended)

1. Install cert-manager:
```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml
```

2. Create a ClusterIssuer:
```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: your-email@example.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
      - http01:
          ingress:
            class: nginx
```

3. Add annotation to ingress:
```yaml
annotations:
  cert-manager.io/cluster-issuer: "letsencrypt-prod"
```

### Manual TLS

1. Create TLS secret:
```bash
kubectl create secret tls payd-tls \
  --cert=path/to/tls.crt \
  --key=path/to/tls.key \
  -n payd
```

## Horizontal Pod Autoscaling

The backend HPA is enabled by default and scales based on CPU (70%) and memory (80%) utilization.

### Verify HPA

```bash
kubectl get hpa -n payd
kubectl describe hpa payd-backend-hpa -n payd
```

### Test Scaling

```bash
# Generate load to trigger scaling
kubectl run -i --tty load-generator --rm --image=busybox --restart=Never -- /bin/sh

# Inside the pod:
while true; do wget -q -O- http://payd-backend:3001/health; done
```

## Environment-Specific Deployments

### Staging

```bash
helm install payd-staging charts/payd \
  --namespace payd-staging \
  --create-namespace \
  --set backend.config.NODE_ENV=staging \
  --set backend.replicaCount=1 \
  --set backend.autoscaling.enabled=false \
  --set ingress.hosts[0].host=staging.payd.example.com
```

### Production

```bash
helm install payd charts/payd \
  --namespace payd \
  --create-namespace \
  -f charts/payd/values-production.yaml
```

## Troubleshooting

### Check Pod Logs

```bash
kubectl logs -l app.kubernetes.io/component=backend -n payd
kubectl logs -l app.kubernetes.io/component=frontend -n payd
```

### Check Events

```bash
kubectl get events -n payd --sort-by='.lastTimestamp'
```

### Debug Deployment

```bash
kubectl describe deployment payd-backend -n payd
kubectl describe pod <pod-name> -n payd
```

### Common Issues

1. **Pods not starting**: Check image pull errors and secrets
2. **Service not reachable**: Verify selectors and ports
3. **Ingress not working**: Check ingress controller and annotations
4. **HPA not scaling**: Ensure metrics-server is installed

## Cleanup

```bash
# Remove Helm release
helm uninstall payd --namespace payd

# Remove namespace
kubectl delete namespace payd

# Or remove raw manifests
kubectl delete -k k8s/base/
```

## Security Considerations

1. **Secrets Management**: Never commit real secrets to `backend-secret.yaml`. Use `kubectl create secret` from env vars, CI secret injection, or the External Secrets Operator (see [k8s/README.md](../k8s/README.md)). A pre-commit hook and CI check enforce this automatically.
2. **Network Policies**: Add NetworkPolicy resources to restrict pod-to-pod communication
3. **Pod Security**: Enable Pod Security Standards/Policies
4. **RBAC**: Create ServiceAccounts with minimal permissions
5. **Image Security**: Use image scanning and signing

## Next Steps

- Set up monitoring with Prometheus and Grafana
- Configure log aggregation with ELK or Loki
- Implement CI/CD pipeline for automated deployments
- Add database migration as a K8s Job
- Configure backup and disaster recovery
