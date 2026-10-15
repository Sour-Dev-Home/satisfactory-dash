variable "region" {
  description = "AWS region for every resource (ADR-0034 prices were checked in us-east-1)."
  type        = string
  default     = "us-east-1"
}

variable "vpc_cidr" {
  description = "The VPC's address range."
  type        = string
  default     = "10.40.0.0/16"

  validation {
    condition     = can(cidrsubnet(var.vpc_cidr, 8, 1))
    error_message = "vpc_cidr must be an IPv4 CIDR of /24 or larger."
  }
}

variable "availability_zones" {
  description = "Two AZs for the public subnets (an RDS subnet group needs two, even for single-AZ)."
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]

  validation {
    condition     = length(var.availability_zones) == 2 && length(distinct(var.availability_zones)) == 2
    error_message = "availability_zones holds exactly two different zones."
  }
}

variable "db_name" {
  description = "The database RDS creates at launch; the migrate job creates the app roles in it."
  type        = string
  default     = "satis"
}

variable "db_master_username" {
  description = "RDS master user name. Its password is generated and kept in Secrets Manager by RDS."
  type        = string
  default     = "satis_admin"
}

variable "db_deletion_protection" {
  description = "Keep on while running; the owner turns it off for the exit's terraform destroy (ADR-0034 §6)."
  type        = bool
  default     = true
}

variable "monthly_budget_usd" {
  description = "Monthly gross spend (before credits) that triggers the budget alerts. ADR-0034 expects about $33."
  type        = number
  default     = 40

  validation {
    condition     = var.monthly_budget_usd > 0
    error_message = "monthly_budget_usd must be above zero."
  }
}

variable "budget_alert_email" {
  description = "Where budget alerts go. Set it in the git-ignored terraform.tfvars, never in a tracked file."
  type        = string

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.budget_alert_email))
    error_message = "budget_alert_email must be an email address."
  }
}
