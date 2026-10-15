# SSM Parameter Store names under /satis/prod/ (ADR-0034 §2). Terraform only names them: the owner
# puts each value in by hand as a SecureString (see README.md), and the ECS task definition (a later
# issue) injects them as environment variables. Never a data source or resource for these, since
# either would copy the value into state.

locals {
  ssm_prefix = "/satis/prod/"

  # Environment variable name => SSM parameter name. The keys match backend/.env.example and
  # compose.yaml, so the task definition can map them one to one.
  ssm_secret_keys = [
    # The backend (compose.yaml's backend service)
    "DATABASE_URL",
    "DASHBOARD_ADMIN_USER",
    "DASHBOARD_ADMIN_PASSWORD_HASH",
    "SESSION_SECRET",
    "SERVER_SECRETS_KEY",
    "SERVER_SECRETS_KEY_ID",
    "SERVER_SECRETS_PREVIOUS_KEYS",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "BOOTSTRAP_OWNER_EMAIL",
    # The migrate job's role passwords
    "DB_MIGRATOR_PASSWORD",
    "DB_APP_PASSWORD",
    # cloudflared
    "TUNNEL_TOKEN",
    # The backup job (ADR-0035: Backblaze B2 through its S3-compatible API, and the heartbeat)
    "B2_ACCESS_KEY_ID",
    "B2_SECRET_ACCESS_KEY",
    "BACKUP_AGE_RECIPIENT",
    "BACKUP_HEARTBEAT_URL",
  ]

  ssm_parameter_names = { for k in local.ssm_secret_keys : k => "${local.ssm_prefix}${k}" }

  # For the task execution role's ssm:GetParameters policy. Names start with "/", so the ARN joins
  # "parameter" and the name with no extra slash.
  ssm_parameter_arns = {
    for k, name in local.ssm_parameter_names :
    k => "arn:${data.aws_partition.current.partition}:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter${name}"
  }
}
