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

variable "db_backup_retention_days" {
  description = "Days of RDS automated backups (point-in-time restore). The AWS Free plan refused 7 at the first apply (#418); set 0 to turn automated backups off if it refuses 1 too. The nightly B2 backup (ADR-0035) is the backup either way."
  type        = number
  default     = 1

  validation {
    condition     = var.db_backup_retention_days >= 0 && var.db_backup_retention_days <= 7 && floor(var.db_backup_retention_days) == var.db_backup_retention_days
    error_message = "db_backup_retention_days must be a whole number from 0 to 7."
  }
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

variable "ops_image" {
  description = "The ops image by digest (repo@sha256:...), for the db-init, db-migrate, backup and restore tasks. Never a tag such as :main."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9./_-]*(:[A-Za-z0-9._-]+)?@sha256:[0-9a-f]{64}$", var.ops_image))
    error_message = "ops_image must be pinned by digest: <repository>@sha256:<64 hex>."
  }
}

variable "backup_b2" {
  description = "The Backblaze B2 bucket the backup writes to and the restore reads from (ADR-0035): bucket name, S3 endpoint (https://s3.<region>.backblazeb2.com) and that region. Not secret, but kept out of the repo in terraform.tfvars."
  type        = object({ bucket = string, endpoint = string, region = string })

  validation {
    condition     = can(regex("^[A-Za-z0-9][A-Za-z0-9-]{4,61}[A-Za-z0-9]$", var.backup_b2.bucket))
    error_message = "backup_b2.bucket must be a B2 bucket name (6 to 63 letters, digits and dashes)."
  }

  validation {
    # The backup's own BACKUP_S3_ENDPOINT rule, tightened: an https origin, no credentials, no path.
    condition     = can(regex("^https://[A-Za-z0-9.-]+(:[0-9]+)?/?$", var.backup_b2.endpoint))
    error_message = "backup_b2.endpoint must be an https:// origin without credentials or a path."
  }

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.backup_b2.region))
    error_message = "backup_b2.region must be a region name, the one in the endpoint."
  }
}

variable "backup_schedule" {
  description = "When EventBridge Scheduler runs the backup task, in UTC. The default is after the RDS backup (07:00) and maintenance (08:00) windows."
  type        = string
  default     = "cron(0 9 * * ? *)"

  validation {
    condition     = can(regex("^(cron|rate)\\(.+\\)$", var.backup_schedule))
    error_message = "backup_schedule must be a Scheduler cron(...) or rate(...) expression."
  }
}

variable "backup_heartbeat_enabled" {
  description = "Inject /satis/prod/BACKUP_HEARTBEAT_URL into the backup task. Create the parameter first: a missing one stops the task from starting."
  type        = bool
  default     = false
}

# --- CloudWatch alarms (#501) ---

variable "alarm_email" {
  description = "Where the CloudWatch alarms email (an SNS subscription you must confirm). No default: set it in the git-ignored terraform.tfvars, never in a tracked file (the repo is public)."
  type        = string

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.alarm_email))
    error_message = "alarm_email must be an email address."
  }
}

variable "alarms" {
  description = "Thresholds and windows for the alarms in alarms.tf. Every alarm also mails when it returns to OK. A period is a CloudWatch period (10, 30 or a multiple of 60 seconds); an alarm fires after evaluation_periods in a row breach."
  type = object({
    ecs_running_tasks_min    = optional(number, 1)
    ecs_period_seconds       = optional(number, 60)
    ecs_evaluation_periods   = optional(number, 3)
    rds_free_storage_min_gib = optional(number, 3)
    rds_storage_period       = optional(number, 300)
    rds_cpu_max_percent      = optional(number, 80)
    rds_cpu_period_seconds   = optional(number, 300)
    rds_cpu_evaluation       = optional(number, 3)
    backend_errors_max       = optional(number, 5)
    backend_errors_period    = optional(number, 300)
    # #560: one fatal line or one escalated worker failure pages on its own.
    backend_critical_max    = optional(number, 1)
    backend_critical_period = optional(number, 300)
    # #560: failed and refused sign-ins (password and Google) across all clients.
    auth_failures_max    = optional(number, 20)
    auth_failures_period = optional(number, 300)
  })
  default = {}

  validation {
    condition = alltrue([
      for p in [var.alarms.ecs_period_seconds, var.alarms.rds_storage_period, var.alarms.rds_cpu_period_seconds, var.alarms.backend_errors_period, var.alarms.backend_critical_period, var.alarms.auth_failures_period] :
      p == 10 || p == 30 || (p >= 60 && p % 60 == 0)
    ])
    error_message = "Alarm periods must be 10, 30, or a multiple of 60 seconds."
  }

  validation {
    condition     = var.alarms.rds_cpu_max_percent > 0 && var.alarms.rds_cpu_max_percent <= 100 && var.alarms.ecs_evaluation_periods >= 1 && var.alarms.rds_cpu_evaluation >= 1
    error_message = "rds_cpu_max_percent must be 1 to 100 and evaluation periods at least 1."
  }

  validation {
    condition     = var.alarms.backend_errors_max >= 1 && var.alarms.backend_critical_max >= 1 && var.alarms.auth_failures_max >= 1
    error_message = "backend_errors_max, backend_critical_max and auth_failures_max must be at least 1."
  }
}

variable "github_repository" {
  description = "owner/repo whose deploy.yml may assume the deploy role (ADR-0049 D1), exactly as GitHub's OIDC token spells it."
  type        = string
  default     = "Sour-Dev-Home/satisfactory-dash"

  validation {
    condition     = can(regex("^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$", var.github_repository))
    error_message = "github_repository must be owner/repo."
  }
}

variable "github_subject_prefix" {
  description = "The `sub` claim's repo part, exactly as `gh api repos/<owner>/<repo>/actions/oidc/customization/sub` reports `sub_claim_prefix` (GitHub's immutable subject: names plus numeric ids)."
  type        = string
  default     = "repo:Sour-Dev-Home@332263924/satisfactory-dash@1380549261"

  validation {
    condition     = can(regex("^repo:[A-Za-z0-9-]+@[0-9]+/[A-Za-z0-9._-]+@[0-9]+$", var.github_subject_prefix))
    error_message = "github_subject_prefix must be repo:<owner>@<owner id>/<repo>@<repo id>."
  }
}
