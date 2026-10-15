terraform {
  # 1.11 is the first release where the S3 backend's native lock file (use_lockfile) is GA.
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # The state bucket comes from bootstrap/ (see README.md) and is passed at init time:
  #   terraform init -backend-config=prod.s3.tfbackend
  # with the bucket name in that git-ignored file (prod.s3.tfbackend.example shows its shape).
  # S3 keeps the lock next to the state, so no DynamoDB table is needed.
  backend "s3" {
    key          = "satis/prod/base.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
