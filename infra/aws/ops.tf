# ADR-0034 §6-7 (#409): the ops image's jobs as ECS tasks inside the VPC, since RDS is private to it.
# db-init, db-migrate and restore are one-off `aws ecs run-task` runs by the owner; the backup also
# runs nightly from schedule.tf. Each task has its own execution role (ops_iam.tf) that reads only
# the values it injects, and none has a task role, so no container holds AWS credentials. The
# runbook is docs-vault/wiki/runbooks/aws.md.

locals {
  # TLS to RDS with the CA bundle both images carry (backend/Dockerfile).
  rds_tls_query = "sslmode=verify-full&sslrootcert=/etc/ssl/rds/global-bundle.pem"

  # The master password RDS keeps in Secrets Manager (rds.tf). Only db-init reads it (decision D4).
  db_master_secret_arn = aws_db_instance.main.master_user_secret[0].secret_arn

  # Per-run values for the restore (decision D5): the owner puts each in just before a restore and
  # deletes it right after (the runbook), so the age private key and the B2 read key are never kept in
  # SSM or Secrets Manager. Terraform only names them, as ssm.tf does, and never holds a value.
  restore_ssm_prefix = "/satis/restore/"
  restore_ssm_keys   = ["AGE_IDENTITY", "B2_READ_KEY_ID", "B2_READ_APPLICATION_KEY"]
  restore_ssm_arns = {
    for k in local.restore_ssm_keys :
    k => "arn:${data.aws_partition.current.partition}:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter${local.restore_ssm_prefix}${k}"
  }

  # Where the AWS CLI finds the B2 bucket (ADR-0035). The backup passes AWS_* on to the CLI.
  b2_environment = {
    BACKUP_S3_BUCKET   = var.backup_b2.bucket
    BACKUP_S3_ENDPOINT = var.backup_b2.endpoint
    AWS_DEFAULT_REGION = var.backup_b2.region
  }

  # DATABASE_ADMIN_URL from the master password, URL-encoded by node since RDS generates it with
  # punctuation. Only DATABASE_ADMIN_URL carries the password into db:init, which never prints it.
  db_init_script = <<-EOT
    set -eu
    DATABASE_ADMIN_URL="$(node -e 'const e = process.env; process.stdout.write("postgres://" + encodeURIComponent(e.DB_MASTER_USERNAME) + ":" + encodeURIComponent(e.DB_MASTER_PASSWORD) + "@" + e.DB_HOST + ":" + e.DB_PORT + "/postgres?" + e.DB_TLS_QUERY)')"
    export DATABASE_ADMIN_URL
    unset DB_MASTER_PASSWORD
    exec npm run --silent db:init -w backend
  EOT

  # backup.ts always runs `aws s3 cp --profile <BACKUP_AWS_PROFILE>`, and an explicit profile makes the AWS
  # CLI ignore key variables in the environment, so the task needs a profile of that name. As on the compose
  # host (a mounted credentials file), it writes one, private to the container, with the B2 upload key.
  backup_script = <<-EOT
    set -eu
    umask 077
    cfg="$(mktemp -d)"
    printf '[profile %s]\nregion = %s\n' "$BACKUP_AWS_PROFILE" "$AWS_DEFAULT_REGION" > "$cfg/config"
    printf '[%s]\naws_access_key_id = %s\naws_secret_access_key = %s\n' "$BACKUP_AWS_PROFILE" "$B2_ACCESS_KEY_ID" "$B2_SECRET_ACCESS_KEY" > "$cfg/credentials"
    unset B2_ACCESS_KEY_ID B2_SECRET_ACCESS_KEY
    export AWS_CONFIG_FILE="$cfg/config" AWS_SHARED_CREDENTIALS_FILE="$cfg/credentials"
    exec npm run --silent backup -w backend
  EOT

  # One backup from B2 (RESTORE_FILE, set per run) into the database MIGRATOR_DATABASE_URL names, as
  # satis_migrator, which owns it. One transaction, so a restore over existing tables fails and
  # changes nothing. The prefix is backup.ts's S3_KEY_PREFIX (a static test keeps them equal).
  restore_script = <<-EOT
    set -eu
    case "$${RESTORE_FILE:-}" in
      */* | *..*) echo "[restore] RESTORE_FILE is a file name, not a path" >&2; exit 2 ;;
      satis-*.dump.age) ;;
      *) echo "[restore] set RESTORE_FILE to a backup's file name (satis-<time>.dump.age)" >&2; exit 2 ;;
    esac
    umask 077
    work="$(mktemp -d)"
    trap 'rm -rf "$work"' EXIT
    aws s3 cp --only-show-errors --endpoint-url "$BACKUP_S3_ENDPOINT" "s3://$BACKUP_S3_BUCKET/satis-dash/$RESTORE_FILE" "$work/backup.age"
    printf '%s\n' "$AGE_IDENTITY" > "$work/identity"
    unset AGE_IDENTITY AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
    age --decrypt --identity "$work/identity" --output "$work/satis.dump" "$work/backup.age"
    rm -f "$work/identity" "$work/backup.age"
    pg_restore --no-owner --single-transaction --dbname "$RESTORE_DATABASE_URL" "$work/satis.dump"
    echo "[restore] done: $RESTORE_FILE. Next: the db-migrate task, then scale the service back to 1."
  EOT

  # Every ops task: its command, plain settings, SSM values (env name => parameter ARN) and whether it
  # also reads the master secret.
  ops_tasks = {
    "db-init" = {
      command = ["sh", "-c", local.db_init_script]
      environment = {
        DB_NAME            = var.db_name
        DB_MASTER_USERNAME = var.db_master_username
        DB_HOST            = aws_db_instance.main.address
        DB_PORT            = tostring(aws_db_instance.main.port)
        DB_TLS_QUERY       = local.rds_tls_query
      }
      ssm = {
        DB_MIGRATOR_PASSWORD = local.ssm_parameter_arns["DB_MIGRATOR_PASSWORD"]
        DB_APP_PASSWORD      = local.ssm_parameter_arns["DB_APP_PASSWORD"]
        DB_BACKUP_PASSWORD   = local.ssm_parameter_arns["DB_BACKUP_PASSWORD"]
      }
      master_secret = true
    }
    "db-migrate" = {
      command       = ["npm", "run", "--silent", "db:migrate", "-w", "backend"]
      environment   = {}
      ssm           = { MIGRATOR_DATABASE_URL = local.ssm_parameter_arns["MIGRATOR_DATABASE_URL"] }
      master_secret = false
    }
    # The same command as compose.yaml's backup service, as the read-only satis_backup role.
    "backup" = {
      command     = ["sh", "-c", local.backup_script]
      environment = merge(local.b2_environment, { BACKUP_LOCAL_DIR = "/var/backups/satis", BACKUP_AWS_PROFILE = "satis-backup" })
      ssm = merge(
        {
          BACKUP_DATABASE_URL  = local.ssm_parameter_arns["BACKUP_DATABASE_URL"]
          BACKUP_AGE_RECIPIENT = local.ssm_parameter_arns["BACKUP_AGE_RECIPIENT"]
          B2_ACCESS_KEY_ID     = local.ssm_parameter_arns["B2_ACCESS_KEY_ID"]
          B2_SECRET_ACCESS_KEY = local.ssm_parameter_arns["B2_SECRET_ACCESS_KEY"]
        },
        var.backup_heartbeat_enabled ? { BACKUP_HEARTBEAT_URL = local.ssm_parameter_arns["BACKUP_HEARTBEAT_URL"] } : {},
      )
      master_secret = false
    }
    "restore" = {
      command     = ["sh", "-c", local.restore_script]
      environment = local.b2_environment
      ssm = {
        RESTORE_DATABASE_URL  = local.ssm_parameter_arns["MIGRATOR_DATABASE_URL"]
        AGE_IDENTITY          = local.restore_ssm_arns["AGE_IDENTITY"]
        AWS_ACCESS_KEY_ID     = local.restore_ssm_arns["B2_READ_KEY_ID"]
        AWS_SECRET_ACCESS_KEY = local.restore_ssm_arns["B2_READ_APPLICATION_KEY"]
      }
      master_secret = false
    }
  }
}

resource "aws_ecs_task_definition" "ops" {
  for_each = local.ops_tasks

  family                   = "satis-${local.environment}-ops-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"

  # ADR-0049 D2, as for the backend: db-migrate's revision is CI's base, and old revisions stay registered.
  track_latest = false
  skip_destroy = true

  # No task role: the jobs call no AWS API (the B2 upload is an S3-compatible API with a B2 key).
  execution_role_arn = aws_iam_role.ops_execution[each.key].arn

  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    {
      # One name for every task, so `run-task --overrides` always names container "ops".
      name        = "ops"
      image       = var.ops_image
      essential   = true
      command     = each.value.command
      environment = [for k in sort(keys(each.value.environment)) : { name = k, value = each.value.environment[k] }]
      secrets = concat(
        [for k in sort(keys(each.value.ssm)) : { name = k, valueFrom = each.value.ssm[k] }],
        each.value.master_secret ? [{ name = "DB_MASTER_PASSWORD", valueFrom = "${local.db_master_secret_arn}:password::" }] : [],
      )
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ops.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = each.key
        }
      }
    },
  ])
}
