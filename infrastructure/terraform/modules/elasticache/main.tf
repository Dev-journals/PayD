variable "environment" {
  description = "Environment name (staging/production)"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "subnet_ids" {
  description = "Subnet IDs for Elasticache"
  type        = list(string)
}

variable "node_type" {
  description = "Elasticache node type"
  type        = string
  default     = "cache.t3.micro"
}

variable "num_cache_nodes" {
  description = "Number of cache nodes"
  type        = number
  default     = 1
}

variable "engine_version" {
  description = "Redis engine version"
  type        = string
  default     = "7.0"
}

variable "port" {
  description = "Redis port"
  type        = number
  default     = 6379
}

variable "parameter_group_name" {
  description = "ElastiCache parameter group name"
  type        = string
  default     = ""
}

variable "automatic_failover_enabled" {
  description = "Enable automatic failover"
  type        = bool
  default     = false
}

variable "multi_az_enabled" {
  description = "Enable Multi-AZ"
  type        = bool
  default     = false
}

variable "at_rest_encryption_enabled" {
  description = "Enable at-rest encryption"
  type        = bool
  default     = true
}

variable "transit_encryption_enabled" {
  description = "Enable transit encryption"
  type        = bool
  default     = true
}

variable "auth_token" {
  description = "Redis auth token"
  type        = string
  sensitive   = true
}

variable "snapshot_retention_days" {
  description = "Number of days to retain snapshots"
  type        = number
  default     = 7
}

variable "snapshot_window" {
  description = "Snapshot window"
  type        = string
  default     = "03:00-05:00"
}

variable "maintenance_window" {
  description = "Maintenance window"
  type        = string
  default     = "mon:05:00-mon:07:00"
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

resource "aws_elasticache_subnet_group" "main" {
  name       = local.name
  subnet_ids = var.subnet_ids

  tags = merge(local.default_tags, {
    Name = "${local.name}-cache-subnet-group"
  })
}

resource "aws_elasticache_parameter_group" "redis" {
  name   = var.parameter_group_name != "" ? var.parameter_group_name : "${local.name}-redis"
  family = "redis7"

  dynamic "parameter" {
    for_each = var.engine_version == "7.0" ? ["tcp-keepalive 300"] : []
    content {
      name  = parameter.value
      value = "300"
    }
  }

  tags = merge(local.default_tags, {
    Name = "${local.name}-redis-param-group"
  })
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id       = local.name
  description = "PayD Redis Cache"

  engine               = "redis"
  engine_version       = var.engine_version
  node_type            = var.node_type
  num_cache_clusters   = var.num_cache_nodes
  port                 = var.port
  parameter_group_name = aws_elasticache_parameter_group.redis.name
  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [aws_security_group.redis.id]

  automatic_failover_enabled    = var.automatic_failover_enabled
  multi_az_enabled             = var.multi_az_enabled
  at_rest_encryption_enabled    = var.at_rest_encryption_enabled
  transit_encryption_enabled    = var.transit_encryption_enabled
  auth_token                    = var.auth_token

  snapshot_retention_limit   = var.snapshot_retention_days
  snapshot_window           = var.snapshot_window
  maintenance_window        = var.maintenance_window

  auto_minor_version_upgrade = true
  apply_immediately         = false

  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.redis_slow.name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    log_type         = "slow-log"
  }

  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.redis_engine.name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    log_type         = "engine-log"
  }

  tags = merge(local.default_tags, {
    Name = "${local.name}-redis"
  })
}

resource "aws_security_group" "redis" {
  name        = "${local.name}-redis-sg"
  description = "Security group for ElastiCache Redis"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = var.port
    to_port     = var.port
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
    description = "Redis from VPC"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound"
  }

  tags = merge(local.default_tags, {
    Name = "${local.name}-redis-sg"
  })
}

resource "aws_cloudwatch_log_group" "redis_slow" {
  name              = "/aws/elasticache/${local.name}/slow-log"
  retention_in_days = 7

  tags = merge(local.default_tags, {
    Name = "${local.name}-redis-slow-log"
  })
}

resource "aws_cloudwatch_log_group" "redis_engine" {
  name              = "/aws/elasticache/${local.name}/engine-log"
  retention_in_days = 7

  tags = merge(local.default_tags, {
    Name = "${local.name}-redis-engine-log"
  })
}

output "redis_endpoint" {
  description = "Redis primary endpoint"
  value       = aws_elasticache_replication_group.main.primary_endpoint_address
}

output "redis_reader_endpoint" {
  description = "Redis reader endpoint"
  value       = aws_elasticache_replication_group.main.reader_endpoint_address
}

output "redis_port" {
  description = "Redis port"
  value       = aws_elasticache_replication_group.main.port
}

output "security_group_id" {
  description = "Redis security group ID"
  value       = aws_security_group.redis.id
}

output "replication_group_id" {
  description = "Replication group ID"
  value       = aws_elasticache_replication_group.main.id
}
