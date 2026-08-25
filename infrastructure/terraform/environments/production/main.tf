terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "payd-terraform-state"
    key            = "production/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "payd-terraform-locks"
  }
}

provider "aws" {
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = "PayD"
      Environment = "production"
      ManagedBy   = "Terraform"
    }
  }
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

locals {
  environment = "production"
}

module "vpc" {
  source = "../../modules/vpc"

  environment = local.environment

  vpc_cidr            = "10.1.0.0/16"
  availability_zones = ["us-east-1a", "us-east-1b", "us-east-1c"]

  public_subnet_cidrs  = ["10.1.1.0/24", "10.1.2.0/24", "10.1.3.0/24"]
  private_subnet_cidrs = ["10.1.11.0/24", "10.1.12.0/24", "10.1.13.0/24"]
  database_subnet_cidrs = ["10.1.21.0/24", "10.1.22.0/24", "10.1.23.0/24"]

  enable_nat_gateway     = true
  single_nat_gateway    = false

  tags = {}
}

module "secrets" {
  source = "../../modules/secrets"

  environment      = local.environment
  db_master_password = var.db_password
  redis_auth_token = var.redis_auth_token
  jwt_secret       = var.jwt_secret

  tags = {}
}

module "rds" {
  source = "../../modules/rds"

  environment = local.environment

  db_subnet_group_name = module.vpc.db_subnet_group_name
  vpc_id              = module.vpc.vpc_id

  instance_class    = "db.t3.small"
  allocated_storage = 50
  storage_type      = "gp3"
  engine_version    = "15.4"
  db_name           = "payd_production"
  master_username  = "paydadmin"
  db_password       = var.db_password

  backup_retention_days = 30
  multi_az              = true
  deletion_protection   = true
  skip_final_snapshot   = false

  tags = {}
}

module "elasticache" {
  source = "../../modules/elasticache"

  environment = local.environment

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.database_subnet_ids

  node_type           = "cache.t3.small"
  num_cache_nodes     = 2
  engine_version      = "7.0"
  port                = 6379

  automatic_failover_enabled = true
  multi_az_enabled          = true
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token               = var.redis_auth_token

  snapshot_retention_days = 7

  tags = {}
}

module "ecs" {
  source = "../../modules/ecs"

  environment = local.environment

  vpc_id            = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  public_subnet_ids = module.vpc.public_subnet_ids

  ecs_cluster_name = "payd-production-cluster"

  container_name  = "payd-backend"
  container_image = "payd-backend:latest"
  container_port  = 3001

  cpu     = 512
  memory  = 1024
  desired_count = 2

  min_capacity = 2
  max_capacity = 8

  db_host                   = module.rds.db_instance_address
  db_port                   = module.rds.db_instance_port
  db_name                   = module.rds.db_name
  db_username               = "paydadmin"
  db_password_secret_arn    = module.secrets.db_credentials_secret_arn

  redis_host                = module.elasticache.redis_endpoint
  redis_port                = module.elasticache.redis_port
  redis_auth_token_secret_arn = module.secrets.redis_credentials_secret_arn

  stellar_network = "mainnet"
  jwt_secret_arn  = module.secrets.jwt_secret_arn

  tags = {}
}

output "vpc_id" {
  value = module.vpc.vpc_id
}

output "rds_endpoint" {
  value     = module.rds.db_instance_endpoint
  sensitive = true
}

output "redis_endpoint" {
  value = module.elasticache.redis_endpoint
}

output "alb_dns_name" {
  value = module.ecs.alb_dns_name
}
