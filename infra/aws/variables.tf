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

variable "backend_image" {
  description = "The backend app image by digest (repo@sha256:...), from the image workflow's GHCR push. Never a tag such as :main."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9./_-]*(:[A-Za-z0-9._-]+)?@sha256:[0-9a-f]{64}$", var.backend_image))
    error_message = "backend_image must be pinned by digest: <repository>@sha256:<64 hex>."
  }
}

variable "backend_optional_secrets" {
  description = "Optional backend settings to inject from SSM besides the four required ones. Create each /satis/prod/<NAME> before adding it here: a missing parameter stops the task from starting."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for k in var.backend_optional_secrets : contains(local.backend_optional_secret_keys, k)])
    error_message = "backend_optional_secrets holds only the backend's optional SSM settings (see ecs.tf)."
  }
}

variable "backend_environment" {
  description = "Plain, non-secret backend settings (e.g. FRONTEND_ORIGIN, CORS_ALLOWED_ORIGINS, GOOGLE_REDIRECT_URI, ALERT_DELIVERY, LOG_LEVEL)."
  type        = map(string)
  default     = {}

  validation {
    # A plain value lands in state and the task definition, so a secret-looking name is refused too.
    condition = alltrue([for k in keys(var.backend_environment) :
      k != "HOST" && !contains(local.ssm_secret_keys, k) && !can(regex("(?i)(SECRET|PASSWORD|TOKEN|CREDENTIAL|PRIVATE|KEY)", k))
    ])
    error_message = "backend_environment cannot set HOST, a name kept in SSM, or a secret-looking name (put secrets in SSM)."
  }
}
