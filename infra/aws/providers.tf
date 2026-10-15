locals {
  # One environment only (ADR-0034); it names resources and the SSM path /satis/prod/.
  environment = "prod"
}

provider "aws" {
  region = var.region

  # Every resource carries these, so Cost Explorer and the console can tell this stack apart.
  default_tags {
    tags = {
      Project     = "satisfactory-dash"
      Environment = local.environment
      ManagedBy   = "terraform"
      Source      = "infra/aws"
    }
  }
}

data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}
