# ADR-0049 D3 (PR 4): staging, a throwaway task CI starts, tests and stops. No service, so nothing runs (or costs)
# between deploys. One task with its own PostgreSQL, isolated from production by construction: its own cluster, its own
# egress-only security group (the RDS group admits only production's task group, network.tf), its own execution role
# that reads only /satis/staging/, its own tunnel and log group. No production data, no game servers, no alerts, no push.

locals {
  staging_name = "satis-staging"

  # postgres:18 from the ECR Public mirror of the Docker official image (no Docker Hub pull limit), by its multi-arch
  # index digest as of 2026-10-23 (linux/arm64/v8 present).
  staging_postgres_image = "public.ecr.aws/docker/library/postgres:18@sha256:edb0c08dc33befd0262ab3b5cf1c4f3f8cfd8b09e88c05b45adee29d6761ddb6"

  # The owner puts each value by hand as a SecureString (runbooks/aws.md, "Staging"); Terraform only names them.
  staging_ssm_prefix = "/satis/staging/"
  staging_ssm_keys = [
    "TUNNEL_TOKEN", "SESSION_SECRET", "DASHBOARD_ADMIN_USER", "DASHBOARD_ADMIN_PASSWORD_HASH",
    "POSTGRES_PASSWORD", "DB_MIGRATOR_PASSWORD", "DB_APP_PASSWORD", "DATABASE_URL", "MIGRATOR_DATABASE_URL",
  ]
  staging_ssm_arns = {
    for k in local.staging_ssm_keys :
    k => "${local.deploy_arn_prefix}:ssm:${var.region}:${local.deploy_account}:parameter${local.staging_ssm_prefix}${k}"
  }

  # db:init as postgres over loopback (no TLS: the database is in the task), then the previous release's migrations.
  # DATABASE_ADMIN_URL carries the password into db:init only, which never prints it.
  staging_db_previous_script = <<-EOT
    set -eu
    DATABASE_ADMIN_URL="$(node -e 'process.stdout.write("postgres://postgres:" + encodeURIComponent(process.env.POSTGRES_PASSWORD) + "@127.0.0.1:5432/postgres")')"
    export DATABASE_ADMIN_URL
    unset POSTGRES_PASSWORD
    npm run --silent db:init -w backend
    exec npm run --silent db:migrate -w backend
  EOT

  # The backend's plain settings: everything that could reach a person or a game server is off, explicitly.
  staging_backend_environment = {
    HOST               = "127.0.0.1"
    ALERT_DELIVERY     = "off"
    SIGNUP_MODE        = "closed"
    SELF_SERVE_ENABLED = "false"
  }
  staging_backend_secrets = ["DATABASE_URL", "DASHBOARD_ADMIN_USER", "DASHBOARD_ADMIN_PASSWORD_HASH", "SESSION_SECRET"]

  staging_log_options = {
    "awslogs-group"  = aws_cloudwatch_log_group.staging.name
    "awslogs-region" = var.region
  }
}

resource "aws_ecs_cluster" "staging" {
  name = local.staging_name

  setting {
    name  = "containerInsights"
    value = "disabled"
  }
}

resource "aws_cloudwatch_log_group" "staging" {
  name              = "/ecs/${local.staging_name}"
  retention_in_days = 3
}

resource "aws_security_group" "staging" {
  name        = "${local.staging_name}-task"
  description = "Staging task: outbound only, no inbound rules, not admitted by RDS"
  vpc_id      = aws_vpc.main.id

  ingress = []

  egress {
    description      = "Outbound to the tunnel, GHCR, ECR Public, SSM and CloudWatch Logs"
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = []
    prefix_list_ids  = []
    security_groups  = []
    self             = false
  }

  tags = { Name = "${local.staging_name}-task" }
}

resource "aws_iam_role" "staging_execution" {
  name        = "${local.staging_name}-ecs-execution"
  description = "ECS pulls the staging task's /satis/staging/ secrets and writes its logs"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = { StringEquals = { "aws:SourceAccount" = local.deploy_account } }
    }]
  })
}

resource "aws_iam_role_policy" "staging_execution" {
  name = "${local.staging_name}-ecs-execution"
  role = aws_iam_role.staging_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Only /satis/staging/: this role can never read a production secret.
        Sid      = "ReadStagingSecrets"
        Effect   = "Allow"
        Action   = ["ssm:GetParameters"]
        Resource = sort(values(local.staging_ssm_arns))
      },
      {
        Sid      = "WriteStagingLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = ["${aws_cloudwatch_log_group.staging.arn}:log-stream:*"]
      },
    ]
  })
}

# The base CI copies (D2): postgres, then db-previous (db:init and the previous release's migrations, on the released
# ops image), then db-setup (this release's migrations), then the backend, then cloudflared. CI swaps the three app
# images; var.ops_image and var.backend_image are only the bootstrap.
resource "aws_ecs_task_definition" "staging" {
  family                   = local.staging_name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "2048"
  execution_role_arn       = aws_iam_role.staging_execution.arn
  track_latest             = false
  skip_destroy             = true

  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    {
      name      = "postgres"
      image     = local.staging_postgres_image
      essential = true
      # Loopback only: the backend and the setup containers share the task's network namespace.
      command          = ["postgres", "-c", "listen_addresses=127.0.0.1"]
      secrets          = [{ name = "POSTGRES_PASSWORD", valueFrom = local.staging_ssm_arns["POSTGRES_PASSWORD"] }]
      healthCheck      = { command = ["CMD-SHELL", "pg_isready -h 127.0.0.1 -U postgres"], interval = 5, timeout = 5, retries = 12, startPeriod = 10 }
      logConfiguration = { logDriver = "awslogs", options = merge(local.staging_log_options, { "awslogs-stream-prefix" = "postgres" }) }
    },
    {
      name      = "db-previous"
      image     = var.ops_image
      essential = false
      dependsOn = [{ containerName = "postgres", condition = "HEALTHY" }]
      command   = ["sh", "-c", local.staging_db_previous_script]
      secrets = [for k in ["POSTGRES_PASSWORD", "DB_MIGRATOR_PASSWORD", "DB_APP_PASSWORD", "MIGRATOR_DATABASE_URL"] :
      { name = k, valueFrom = local.staging_ssm_arns[k] }]
      logConfiguration = { logDriver = "awslogs", options = merge(local.staging_log_options, { "awslogs-stream-prefix" = "db-previous" }) }
    },
    {
      name             = "db-setup"
      image            = var.ops_image
      essential        = false
      dependsOn        = [{ containerName = "db-previous", condition = "SUCCESS" }]
      command          = ["npm", "run", "--silent", "db:migrate", "-w", "backend"]
      secrets          = [{ name = "MIGRATOR_DATABASE_URL", valueFrom = local.staging_ssm_arns["MIGRATOR_DATABASE_URL"] }]
      logConfiguration = { logDriver = "awslogs", options = merge(local.staging_log_options, { "awslogs-stream-prefix" = "db-setup" }) }
    },
    {
      name        = "backend"
      image       = var.backend_image
      essential   = true
      dependsOn   = [{ containerName = "db-setup", condition = "SUCCESS" }]
      environment = [for k in sort(keys(local.staging_backend_environment)) : { name = k, value = local.staging_backend_environment[k] }]
      secrets     = [for k in local.staging_backend_secrets : { name = k, valueFrom = local.staging_ssm_arns[k] }]
      healthCheck = {
        command     = ["CMD", "node", "-e", local.backend_health_probe]
        interval    = 10
        timeout     = 5
        retries     = 6
        startPeriod = 30
      }
      logConfiguration = { logDriver = "awslogs", options = merge(local.staging_log_options, { "awslogs-stream-prefix" = "backend" }) }
    },
    {
      name             = "cloudflared"
      image            = local.cloudflared_image
      essential        = true
      dependsOn        = [{ containerName = "backend", condition = "HEALTHY" }]
      command          = ["tunnel", "--no-autoupdate", "--metrics", "127.0.0.1:20241", "run"]
      environment      = [{ name = "TUNNEL_URL", value = "http://127.0.0.1:3001" }]
      secrets          = [{ name = "TUNNEL_TOKEN", valueFrom = local.staging_ssm_arns["TUNNEL_TOKEN"] }]
      logConfiguration = { logDriver = "awslogs", options = merge(local.staging_log_options, { "awslogs-stream-prefix" = "cloudflared" }) }
    },
  ])
}

# D1: deploy.yml on main in the `staging` environment only, as for production.
resource "aws_iam_role" "staging_deploy" {
  name                 = "${local.staging_name}-deploy"
  description          = "GitHub Actions deploy.yml on main, environment staging (ADR-0049)"
  max_session_duration = 3600
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "${var.github_subject_prefix}:environment:staging:job_workflow_ref:${var.github_repository}/.github/workflows/deploy.yml@refs/heads/main"
        }
      }
    }]
  })
}

# Exactly D1's staging table; tests/staging.tftest.hcl asserts every action list.
# Accepted residual (security review, PR 4): ECS has no IAM condition on RunTask's network settings, so a session of
# this role could start a staging revision with production's task group, which RDS admits: network reach to the
# database, not its credentials (the execution role reads only /satis/staging/). Only deploy.yml on main can assume
# this role, and that same file already assumes satis-prod-deploy, which runs code holding production's secrets, so
# this adds no reach. The workflow passes only /satis/deploy/staging/network and refuses anything else (PR 5).
resource "aws_iam_role_policy" "staging_deploy" {
  name = "${local.staging_name}-deploy"
  role = aws_iam_role.staging_deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "TaskDefinitions"
        Effect   = "Allow"
        Action   = ["ecs:RegisterTaskDefinition", "ecs:DescribeTaskDefinition"]
        Resource = "*"
      },
      {
        Sid       = "RunStaging"
        Effect    = "Allow"
        Action    = ["ecs:RunTask"]
        Resource  = "${local.deploy_arn_prefix}:ecs:${var.region}:${local.deploy_account}:task-definition/${local.staging_name}:*"
        Condition = { ArnEquals = { "ecs:cluster" = aws_ecs_cluster.staging.arn } }
      },
      {
        Sid       = "WatchAndStop"
        Effect    = "Allow"
        Action    = ["ecs:DescribeTasks", "ecs:StopTask"]
        Resource  = "${local.deploy_arn_prefix}:ecs:${var.region}:${local.deploy_account}:task/${local.staging_name}/*"
        Condition = { ArnEquals = { "ecs:cluster" = aws_ecs_cluster.staging.arn } }
      },
      {
        Sid       = "PassExecutionRole"
        Effect    = "Allow"
        Action    = ["iam:PassRole"]
        Resource  = [aws_iam_role.staging_execution.arn]
        Condition = { StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } }
      },
      {
        Sid      = "ReadLogs"
        Effect   = "Allow"
        Action   = ["logs:GetLogEvents", "logs:FilterLogEvents"]
        Resource = ["${aws_cloudwatch_log_group.staging.arn}:*"]
      },
      {
        # Its own records, and production's release record (the previous ops image for db-previous).
        Sid      = "ReadDeployRecord"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = ["${local.deploy_arn_prefix}:ssm:${var.region}:${local.deploy_account}:parameter/satis/deploy/staging/*", aws_ssm_parameter.deploy_released.arn]
      },
    ]
  })
}

# The staging base and the network settings for RunTask (there is no service to read them from), as plain Strings.
resource "aws_ssm_parameter" "deploy_staging_task_definition" {
  name  = "/satis/deploy/staging/task-definition"
  type  = "String"
  value = aws_ecs_task_definition.staging.arn
}

resource "aws_ssm_parameter" "deploy_staging_network" {
  name = "/satis/deploy/staging/network"
  type = "String"
  value = jsonencode({
    awsvpcConfiguration = { subnets = aws_subnet.public[*].id, securityGroups = [aws_security_group.staging.id], assignPublicIp = "ENABLED" }
  })
}
