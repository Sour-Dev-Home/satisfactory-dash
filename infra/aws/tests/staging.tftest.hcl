# `terraform test` for staging (ADR-0049 D3, D1; PR 4). Same mock provider as deploy.tftest.hcl.

mock_provider "aws" {
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::123456789012:role/satis-staging-mock" }
  }
  mock_resource "aws_iam_openid_connect_provider" {
    defaults = { arn = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com" }
  }
  mock_resource "aws_sns_topic" {
    defaults = { arn = "arn:aws:sns:us-east-1:123456789012:satis-prod-alarms" }
  }
  mock_resource "aws_ecs_cluster" {
    defaults = { arn = "arn:aws:ecs:us-east-1:123456789012:cluster/satis-staging" }
  }
  mock_resource "aws_ecs_task_definition" {
    defaults = { arn = "arn:aws:ecs:us-east-1:123456789012:task-definition/satis-staging:1" }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:us-east-1:123456789012:log-group:/ecs/satis-staging" }
  }
  mock_resource "aws_cloudwatch_metric_alarm" {
    defaults = { arn = "arn:aws:cloudwatch:us-east-1:123456789012:alarm:satis-prod-mock" }
  }
  mock_resource "aws_ssm_parameter" {
    defaults = { arn = "arn:aws:ssm:us-east-1:123456789012:parameter/satis/deploy/prod/released" }
  }
  mock_resource "aws_db_instance" {
    defaults = { master_user_secret = [{ secret_arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:rds!db-mock", kms_key_id = "", secret_status = "active" }] }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
  mock_data "aws_partition" {
    defaults = { partition = "aws" }
  }
}

variables {
  budget_alert_email = "alerts@example.com"
  alarm_email        = "alarms@example.com"
  backend_image      = "ghcr.io/sour-dev-home/satisfactory-dash-backend@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  ops_image          = "ghcr.io/sour-dev-home/satisfactory-dash-ops@sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"
  backup_b2          = { bucket = "example-bucket", endpoint = "https://s3.example-region.backblazeb2.com", region = "example-region" }
}

run "d3_its_own_cluster_log_group_and_egress_only_group_that_rds_never_admits" {
  command = apply

  assert {
    condition     = aws_ecs_cluster.staging.name == "satis-staging" && aws_cloudwatch_log_group.staging.name == "/ecs/satis-staging" && aws_cloudwatch_log_group.staging.retention_in_days == 3
    error_message = "satis-staging cluster, /ecs/satis-staging kept 3 days"
  }

  assert {
    condition     = length(aws_security_group.staging.ingress) == 0 && aws_security_group.staging.id != aws_security_group.task.id
    error_message = "staging's group has no inbound rule and is not production's"
  }

  assert {
    condition     = alltrue([for r in aws_security_group.rds.ingress : !contains(tolist(r.security_groups), aws_security_group.staging.id)])
    error_message = "RDS never admits the staging group"
  }
}

run "d3_the_task_reads_only_staging_secrets_and_runs_the_four_steps_in_order" {
  command = apply

  assert {
    condition     = aws_ecs_task_definition.staging.cpu == "512" && aws_ecs_task_definition.staging.memory == "2048" && aws_ecs_task_definition.staging.runtime_platform[0].cpu_architecture == "ARM64"
    error_message = "0.5 vCPU / 2 GB, ARM64"
  }

  assert {
    condition     = [for c in jsondecode(aws_ecs_task_definition.staging.container_definitions) : c.name] == ["postgres", "db-previous", "db-setup", "backend", "cloudflared"]
    error_message = "postgres, db-previous, db-setup, backend, cloudflared"
  }

  assert {
    condition = { for c in jsondecode(aws_ecs_task_definition.staging.container_definitions) : c.name => try(c.dependsOn[0], null) } == {
      postgres      = null
      "db-previous" = { containerName = "postgres", condition = "HEALTHY" }
      "db-setup"    = { containerName = "db-previous", condition = "SUCCESS" }
      backend       = { containerName = "db-setup", condition = "SUCCESS" }
      cloudflared   = { containerName = "backend", condition = "HEALTHY" }
    }
    error_message = "each step waits for the one before: setup must exit 0 before the backend starts"
  }

  assert {
    condition     = alltrue([for c in jsondecode(aws_ecs_task_definition.staging.container_definitions) : alltrue([for s in try(c.secrets, []) : startswith(s.valueFrom, "arn:aws:ssm:us-east-1:123456789012:parameter/satis/staging/")])])
    error_message = "every secret comes from /satis/staging/, never /satis/prod/ or the RDS master secret"
  }

  assert {
    condition     = tolist(jsondecode(aws_iam_role_policy.staging_execution.policy).Statement[0].Resource) == sort([for k in ["TUNNEL_TOKEN", "SESSION_SECRET", "DASHBOARD_ADMIN_USER", "DASHBOARD_ADMIN_PASSWORD_HASH", "POSTGRES_PASSWORD", "DB_MIGRATOR_PASSWORD", "DB_APP_PASSWORD", "DATABASE_URL", "MIGRATOR_DATABASE_URL"] : "arn:aws:ssm:us-east-1:123456789012:parameter/satis/staging/${k}"])
    error_message = "the execution role reads exactly D3's nine /satis/staging/ values"
  }

  assert {
    condition     = [for c in jsondecode(aws_ecs_task_definition.staging.container_definitions) : c.command if c.name == "postgres"][0] == ["postgres", "-c", "listen_addresses=127.0.0.1"]
    error_message = "postgres listens on loopback only"
  }

  assert {
    condition     = startswith([for c in jsondecode(aws_ecs_task_definition.staging.container_definitions) : c.image if c.name == "postgres"][0], "public.ecr.aws/docker/library/postgres:18@sha256:")
    error_message = "postgres 18 from the ECR Public mirror, by digest"
  }

  assert {
    condition     = [for c in jsondecode(aws_ecs_task_definition.staging.container_definitions) : c.image if c.name == "cloudflared"][0] == local.cloudflared_image
    error_message = "cloudflared at production's pin"
  }

  assert {
    condition = [for c in jsondecode(aws_ecs_task_definition.staging.container_definitions) : { for e in c.environment : e.name => e.value } if c.name == "backend"][0] == {
      HOST = "127.0.0.1", ALERT_DELIVERY = "off", SIGNUP_MODE = "closed", SELF_SERVE_ENABLED = "false"
    }
    error_message = "no alerts, no sign-up, no self-serve, loopback only; and nothing else (no VAPID, Google or server secrets)"
  }

  assert {
    condition     = aws_ecs_task_definition.staging.skip_destroy && !aws_ecs_task_definition.staging.track_latest && aws_ecs_task_definition.staging.task_role_arn == null
    error_message = "a base CI copies: old revisions kept, no task role"
  }
}

run "d1_staging_deploy_role_trusts_only_the_staging_environment_and_never_reaches_production" {
  command = apply

  assert {
    condition     = jsondecode(aws_iam_role.staging_deploy.assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"] == "repo:Sour-Dev-Home@332263924/satisfactory-dash@1380549261:environment:staging:job_workflow_ref:Sour-Dev-Home/satisfactory-dash/.github/workflows/deploy.yml@refs/heads/main"
    error_message = "deploy.yml on main, environment staging"
  }

  assert {
    condition = { for s in jsondecode(aws_iam_role_policy.staging_deploy.policy).Statement : s.Sid => s.Action } == {
      TaskDefinitions   = ["ecs:RegisterTaskDefinition", "ecs:DescribeTaskDefinition"]
      RunStaging        = ["ecs:RunTask"]
      WatchAndStop      = ["ecs:DescribeTasks", "ecs:StopTask"]
      PassExecutionRole = ["iam:PassRole"]
      ReadLogs          = ["logs:GetLogEvents", "logs:FilterLogEvents"]
      ReadDeployRecord  = ["ssm:GetParameter"]
    }
    error_message = "D1's staging table, statement by statement"
  }

  assert {
    condition     = !strcontains(aws_iam_role_policy.staging_deploy.policy, "satis-prod") && !strcontains(aws_iam_role_policy.staging_deploy.policy, "/ecs/satis-prod")
    error_message = "no production cluster, task, service, role or log group anywhere in the staging role"
  }

  assert {
    condition     = alltrue([for s in jsondecode(aws_iam_role_policy.staging_deploy.policy).Statement : try(s.Condition.ArnEquals["ecs:cluster"], "") == "arn:aws:ecs:us-east-1:123456789012:cluster/satis-staging" if contains(["RunStaging", "WatchAndStop"], s.Sid)])
    error_message = "RunTask, DescribeTasks and StopTask only on the staging cluster"
  }
}

run "d2_staging_records_are_plain_strings" {
  command = apply

  assert {
    condition     = aws_ssm_parameter.deploy_staging_task_definition.type == "String" && aws_ssm_parameter.deploy_staging_task_definition.value == aws_ecs_task_definition.staging.arn
    error_message = "the staging base is published for CI"
  }

  assert {
    condition     = aws_ssm_parameter.deploy_staging_network.type == "String" && jsondecode(aws_ssm_parameter.deploy_staging_network.value).awsvpcConfiguration.securityGroups == [aws_security_group.staging.id]
    error_message = "RunTask uses staging's own group"
  }
}
