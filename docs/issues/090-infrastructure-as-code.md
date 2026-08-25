# #090: Infrastructure as Code (Terraform/CloudFormation)

**Category:** [DEVOPS]
**Difficulty:** ● MEDIUM
**Tags:** `terraform`, `aws`, `infrastructure`, `automation`

## Description

Formalize the deployment infrastructure using Terraform or AWS CloudFormation. This ensures that the entire PayD stack (Postgres, Redis, Node.js API, Frontend S3/CloudFront) can be spun up consistently across staging and production environments.

## Acceptance Criteria

- [ ] Terraform modules for VPC, RDS (PostgreSQL), and Elasticache (Redis).
- [ ] ECS or Kubernetes (EKS) manifests for the Backend API.
- [ ] CI/CD pipeline integration (GitHub Actions) to run `terraform plan/apply`.
- [ ] Secrets management integration (AWS Secrets Manager or HashiCorp Vault).
- [ ] Environment-specific variables (testnet vs mainnet endpoints).
