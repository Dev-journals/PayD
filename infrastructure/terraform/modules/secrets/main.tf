variable "environment" {
  description = "Environment name (staging/production)"
  type        = string
}

variable "db_master_password" {
  description = "Database master password"
  type        = string
  sensitive   = true
}

variable "redis_auth_token" {
  description = "Redis auth token"
  type        = string
  sensitive   = true
}

variable "jwt_secret" {
  description = "JWT secret for authentication"
  type        = string
  sensitive   = true
}

variable "stellar_secret_key" {
  description = "Stellar secret key for signing transactions"
  type        = string
  sensitive   = true
  default     = ""
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default     = {}
}

locals {
  name = "payd-${var.environment}"
  default_tags = merge(
    var.tags,
    {
      Environment = var.environment
      Project     = "PayD"
      ManagedBy   = "Terraform"
    }
  )
}

resource "aws_secretsmanager_secret" "db_credentials" {
  name        = "${local.name}/db-credentials"
  description = "Database credentials for PayD ${var.environment}"
  kms_key_id  = aws_kms_key.secrets_manager.arn

  recovery_window_in_days = 7

  tags = merge(local.default_tags, {
    Name = "${local.name}-db-credentials"
  })
}

resource "aws_secretsmanager_secret_version" "db_credentials" {
  secret_id = aws_secretsmanager_secret.db_credentials.id

  secret_string = jsonencode({
    username = "paydadmin"
    password = var.db_master_password
    engine   = "postgres"
  })
}

resource "aws_secretsmanager_secret" "redis_credentials" {
  name        = "${local.name}/redis-credentials"
  description = "Redis credentials for PayD ${var.environment}"
  kms_key_id  = aws_kms_key.secrets_manager.arn

  recovery_window_in_days = 7

  tags = merge(local.default_tags, {
    Name = "${local.name}-redis-credentials"
  })
}

resource "aws_secretsmanager_secret_version" "redis_credentials" {
  secret_id = aws_secretsmanager_secret.redis_credentials.id

  secret_string = jsonencode({
    auth_token = var.redis_auth_token
  })
}

resource "aws_secretsmanager_secret" "jwt_secret" {
  name        = "${local.name}/jwt-secret"
  description = "JWT secret for PayD ${var.environment}"
  kms_key_id  = aws_kms_key.secrets_manager.arn

  recovery_window_in_days = 7

  tags = merge(local.default_tags, {
    Name = "${local.name}-jwt-secret"
  })
}

resource "aws_secretsmanager_secret_version" "jwt_secret" {
  secret_id = aws_secretsmanager_secret.jwt_secret.id

  secret_string = var.jwt_secret
}

resource "aws_secretsmanager_secret" "stellar_credentials" {
  count       = var.stellar_secret_key != "" ? 1 : 0
  name        = "${local.name}/stellar-credentials"
  description = "Stellar credentials for PayD ${var.environment}"
  kms_key_id  = aws_kms_key.secrets_manager.arn

  recovery_window_in_days = 7

  tags = merge(local.default_tags, {
    Name = "${local.name}-stellar-credentials"
  })
}

resource "aws_secretsmanager_secret_version" "stellar_credentials" {
  count   = var.stellar_secret_key != "" ? 1 : 0
  secret_id = aws_secretsmanager_secret.stellar_credentials[0].id

  secret_string = var.stellar_secret_key
}

resource "aws_kms_key" "secrets_manager" {
  description             = "KMS key for PayD secrets"
  deletion_window_in_days = 7
  enable_key_rotation     = true

  tags = merge(local.default_tags, {
    Name = "${local.name}-kms-key"
  })
}

resource "aws_kms_alias" "secrets_manager" {
  name          = "alias/${local.name}-secrets-manager"
  target_key_id = aws_kms_key.secrets_manager.key_id
}

resource "aws_iam_policy" "secrets_read_policy" {
  name        = "${local.name}-secrets-read-policy"
  description = "Policy for ECS tasks to read secrets"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ]
        Resource = [
          aws_secretsmanager_secret.db_credentials.arn,
          aws_secretsmanager_secret.redis_credentials.arn,
          aws_secretsmanager_secret.jwt_secret.arn,
          aws_secretsmanager_secret.stellar_credentials[*].arn
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "kms:Decrypt"
        ]
        Resource = aws_kms_key.secrets_manager.arn
      }
    ]
  })

  tags = merge(local.default_tags, {
    Name = "${local.name}-secrets-read-policy"
  })
}

output "db_credentials_secret_arn" {
  description = "ARN of database credentials secret"
  value       = aws_secretsmanager_secret.db_credentials.arn
}

output "redis_credentials_secret_arn" {
  description = "ARN of Redis credentials secret"
  value       = aws_secretsmanager_secret.redis_credentials.arn
}

output "jwt_secret_arn" {
  description = "ARN of JWT secret"
  value       = aws_secretsmanager_secret.jwt_secret.arn
}

output "stellar_credentials_secret_arn" {
  description = "ARN of Stellar credentials secret"
  value       = length(aws_secretsmanager_secret.stellar_credentials) > 0 ? aws_secretsmanager_secret.stellar_credentials[0].arn : ""
}

output "kms_key_arn" {
  description = "KMS key ARN"
  value       = aws_kms_key.secrets_manager.arn
}

output "secrets_read_policy_arn" {
  description = "Secrets read policy ARN"
  value       = aws_iam_policy.secrets_read_policy.arn
}
