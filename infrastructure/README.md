# PayD Infrastructure as Code

This directory contains Terraform configurations for deploying the PayD application infrastructure on AWS.

## Architecture

The infrastructure consists of:

- **VPC**: Virtual Private Cloud with public, private, and database subnets
- **RDS**: PostgreSQL database with Multi-AZ support (production)
- **ElastiCache**: Redis cluster for caching and session storage
- **ECS Fargate**: Containerized backend API service
- **Application Load Balancer**: HTTP/HTTPS load balancer
- **Secrets Manager**: Secure storage for sensitive data
- **CloudWatch**: Logging and monitoring

## Directory Structure

```
infrastructure/
├── terraform/
│   ├── modules/
│   │   ├── vpc/          # VPC networking module
│   │   ├── rds/          # PostgreSQL database module
│   │   ├── elasticache/  # Redis cache module
│   │   ├── ecs/          # ECS Fargate service module
│   │   └── secrets/       # Secrets Manager module
│   ├── environments/
│   │   ├── staging/       # Staging environment config
│   │   └── production/   # Production environment config
│   └── .github/
│       └── workflows/     # CI/CD pipelines
└── .github/
    └── workflows/         # GitHub Actions workflows
```

## Prerequisites

1. AWS CLI configured with appropriate credentials
2. Terraform >= 1.6.0 installed
3. S3 bucket for Terraform state storage
4. DynamoDB table for state locking

## Setup

### 1. Create S3 Bucket for State Storage

```bash
aws s3 mb s3://payd-terraform-state --region us-east-1
aws s3api put-bucket-encryption \
  --bucket payd-terraform-state \
  --server-side-encryption-configuration '{"Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]}'
```

### 2. Create DynamoDB Table for State Locking

```bash
aws dynamodb create-table \
  --table-name payd-terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

### 3. Configure AWS Credentials

Create an IAM user with the following permissions:

- AmazonVPCFullAccess
- AmazonRDSFullAccess
- AmazonElastiCacheFullAccess
- AmazonECS_FullAccess
- IAMFullAccess
- SecretsManagerFullAccess
- CloudWatchLogsFullAccess

Or use an existing role with appropriate permissions.

### 4. Configure GitHub Secrets

Add the following secrets to your GitHub repository:

- `AWS_ROLE_ARN`: ARN of the IAM role for staging deployment
- `AWS_ROLE_ARN_PROD`: ARN of the IAM role for production deployment
- `TF_API_TOKEN`: Terraform Cloud API token (if using Terraform Cloud)

## Deployment

### Staging Environment

```bash
cd infrastructure/terraform/environments/staging

# Initialize Terraform
terraform init

# Create workspace (if needed)
terraform workspace new staging

# Plan changes
terraform plan -var-file=staging.tfvars

# Apply changes
terraform apply -var-file=staging.tfvars
```

### Production Environment

```bash
cd infrastructure/terraform/environments/production

# Initialize Terraform
terraform init

# Create workspace (if needed)
terraform workspace new production

# Plan changes
terraform plan -var-file=production.tfvars

# Apply changes
terraform apply -var-file=production.tfvars
```

## CI/CD

The GitHub Actions workflow automatically:

1. Validates Terraform code on pull requests
2. Runs `terraform plan` and posts results as PR comments
3. Deploys to staging on merge to main
4. Deploys to production after staging succeeds
5. Builds and pushes Docker images to ECR

## Environment Variables

### Required Variables

| Variable           | Description                |
| ------------------ | -------------------------- |
| `db_password`      | PostgreSQL master password |
| `redis_auth_token` | Redis authentication token |
| `jwt_secret`       | JWT signing secret         |

### Optional Variables

| Variable     | Default   | Description |
| ------------ | --------- | ----------- |
| `aws_region` | us-east-1 | AWS region  |

## Network Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      VPC (10.0.0.0/16)                  │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │              Public Subnets                       │  │
│  │  10.0.1.0/24 | 10.0.2.0/24 | 10.0.3.0/24        │  │
│  │                                                      │  │
│  │  ┌─────────────────────────────────────────────┐  │  │
│  │  │         Application Load Balancer           │  │  │
│  │  └─────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────┘  │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │             Private Subnets                       │  │
│  │  10.0.11.0/24 | 10.0.12.0/24 | 10.0.13.0/24    │  │
│  │                                                      │  │
│  │  ┌─────────────────────────────────────────────┐  │  │
│  │  │           ECS Fargate Tasks                  │  │  │
│  │  │         (Backend API Service)                │  │  │
│  │  └─────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────┘  │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │             Database Subnets                      │  │
│  │  10.0.21.0/24 | 10.0.22.0/24 | 10.0.23.0/24    │  │
│  │                                                      │  │
│  │  ┌─────────────┐  ┌─────────────────────────┐   │  │
│  │  │ RDS Postgres│  │  ElastiCache Redis      │   │  │
│  │  └─────────────┘  └─────────────────────────┘   │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Security Considerations

1. **Secrets Management**: All sensitive data stored in AWS Secrets Manager
2. **Encryption**: All data encrypted at rest (RDS, ElastiCache) and in transit
3. **Network Isolation**: Database and cache in private subnets
4. **IAM Roles**: Least privilege principle for ECS task roles
5. **Security Groups**: Restricted inbound access

## Monitoring

- CloudWatch Logs for application and system logs
- CloudWatch Metrics for performance monitoring
- RDS Performance Insights for database monitoring
- ECS Service Insights for container monitoring

## Cleanup

To destroy all resources:

```bash
# Staging
cd infrastructure/terraform/environments/staging
terraform destroy -var-file=staging.tfvars

# Production
cd infrastructure/terraform/environments/production
terraform destroy -var-file=production.tfvars
```

**Warning**: This will delete all data. Ensure you have backups before running destroy on production.
