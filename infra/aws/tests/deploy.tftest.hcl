# `terraform test` for the production deploy role and its records (ADR-0049 D1, D2, D5; PR 2). Same mock
# provider as ecs.tftest.hcl: no credentials, no account, and `apply` only fills computed attributes.

mock_provider "aws" {
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::123456789012:role/satis-prod-mock" }
  }
  mock_resource "aws_iam_openid_connect_provider" {
    defaults = { arn = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com" }
  }
  mock_resource "aws_sns_topic" {
    defaults = { arn = "arn:aws:sns:us-east-1:123456789012:satis-prod-alarms" }
  }
  mock_resource "aws_ecs_cluster" {
    defaults = { arn = "arn:aws:ecs:us-east-1:123456789012:cluster/satis-prod" }
  }
  mock_resource "aws_ecs_task_definition" {
    defaults = { arn = "arn:aws:ecs:us-east-1:123456789012:task-definition/satis-prod:1" }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:us-east-1:123456789012:log-group:/ecs/satis-prod/ops" }
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

run "d1_oidc_provider_is_githubs_with_the_sts_audience" {
  command = apply

  assert {
    condition     = aws_iam_openid_connect_provider.github.url == "https://token.actions.githubusercontent.com" && tolist(aws_iam_openid_connect_provider.github.client_id_list) == tolist(["sts.amazonaws.com"])
    error_message = "the provider is GitHub's, audience sts.amazonaws.com"
  }
}

run "d1_only_deploy_yml_on_main_in_production_can_assume_the_role" {
  command = apply

  assert {
    condition     = aws_iam_role.prod_deploy.name == "satis-prod-deploy" && aws_iam_role.prod_deploy.max_session_duration == 3600
    error_message = "satis-prod-deploy, one-hour sessions"
  }

  assert {
    condition = jsondecode(aws_iam_role.prod_deploy.assume_role_policy).Statement == [{
      Effect    = "Allow"
      Principal = { Federated = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com" }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:Sour-Dev-Home/satisfactory-dash:environment:production:job_workflow_ref:Sour-Dev-Home/satisfactory-dash/.github/workflows/deploy.yml@refs/heads/main"
        }
      }
    }]
    error_message = "one statement: the GitHub provider, the sts audience and the exact production subject (no StringLike, no wildcard)"
  }
}

run "d1_permissions_are_exactly_the_adr_table" {
  command = apply

  assert {
    condition = { for s in jsondecode(aws_iam_role_policy.prod_deploy.policy).Statement : s.Sid => s.Action } == {
      TaskDefinitions    = ["ecs:RegisterTaskDefinition", "ecs:DescribeTaskDefinition"]
      RunMigrate         = ["ecs:RunTask"]
      WatchMigrate       = ["ecs:DescribeTasks"]
      RollOut            = ["ecs:UpdateService", "ecs:DescribeServices"]
      PassExecutionRoles = ["iam:PassRole"]
      WatchAlarms        = ["cloudwatch:DescribeAlarms"]
      ReadMigrateLog     = ["logs:GetLogEvents"]
      ReadDeployRecord   = ["ssm:GetParameter"]
      WriteRelease       = ["ssm:PutParameter"]
    }
    error_message = "the deploy role's actions are D1's table, statement by statement"
  }

  assert {
    condition     = alltrue([for s in jsondecode(aws_iam_role_policy.prod_deploy.policy).Statement : s.Effect == "Allow" && alltrue([for a in s.Action : !strcontains(a, "*")])])
    error_message = "no wildcard action, no Deny tricks"
  }

  assert {
    condition     = [for s in jsondecode(aws_iam_role_policy.prod_deploy.policy).Statement : s.Sid if s.Resource == "*"] == ["TaskDefinitions"]
    error_message = "only register/describe task definition (no resource-level permission) may use Resource *"
  }
}

run "d1_resources_are_pinned_to_production" {
  command = apply

  assert {
    condition = { for s in jsondecode(aws_iam_role_policy.prod_deploy.policy).Statement : s.Sid => s.Resource if s.Sid != "TaskDefinitions" && s.Sid != "PassExecutionRoles" && s.Sid != "WatchAlarms" && s.Sid != "WriteRelease" } == {
      RunMigrate       = "arn:aws:ecs:us-east-1:123456789012:task-definition/satis-prod-ops-db-migrate:*"
      WatchMigrate     = "arn:aws:ecs:us-east-1:123456789012:task/satis-prod/*"
      RollOut          = "arn:aws:ecs:us-east-1:123456789012:service/satis-prod/satis-prod"
      ReadMigrateLog   = "arn:aws:logs:us-east-1:123456789012:log-group:/ecs/satis-prod/ops:log-stream:db-migrate/*"
      ReadDeployRecord = "arn:aws:ssm:us-east-1:123456789012:parameter/satis/deploy/prod/*"
    }
    error_message = "each scoped statement names production's migrate family, tasks, service, migrate log streams and deploy records"
  }

  assert {
    condition     = alltrue([for s in jsondecode(aws_iam_role_policy.prod_deploy.policy).Statement : try(s.Condition.ArnEquals["ecs:cluster"], "") == "arn:aws:ecs:us-east-1:123456789012:cluster/satis-prod" if contains(["RunMigrate", "WatchMigrate"], s.Sid)])
    error_message = "RunTask and DescribeTasks only on the production cluster"
  }

  assert {
    condition     = [for s in jsondecode(aws_iam_role_policy.prod_deploy.policy).Statement : s.Condition.StringEquals["iam:PassedToService"] if s.Sid == "PassExecutionRoles"] == ["ecs-tasks.amazonaws.com"] && length([for s in jsondecode(aws_iam_role_policy.prod_deploy.policy).Statement : s.Resource if s.Sid == "PassExecutionRoles"][0]) == 2
    error_message = "PassRole only to ECS tasks, and only the two execution roles"
  }
}

run "d2_deploy_records_are_plain_strings_under_satis_deploy" {
  command = apply

  assert {
    condition     = alltrue([for p in [aws_ssm_parameter.deploy_backend_task_definition, aws_ssm_parameter.deploy_migrate_task_definition, aws_ssm_parameter.deploy_released] : p.type == "String" && startswith(p.name, "/satis/deploy/prod/")])
    error_message = "non-secret String parameters under /satis/deploy/prod/, never /satis/prod/"
  }

  assert {
    condition     = aws_ssm_parameter.deploy_backend_task_definition.value == aws_ecs_task_definition.main.arn && aws_ssm_parameter.deploy_migrate_task_definition.value == aws_ecs_task_definition.ops["db-migrate"].arn
    error_message = "the base revisions CI copies are Terraform's own"
  }
}

run "d2_d5_service_ignores_its_revision_and_rolls_back_on_the_backend_alarms" {
  command = apply

  assert {
    condition     = aws_ecs_task_definition.main.skip_destroy && !aws_ecs_task_definition.main.track_latest && alltrue([for td in aws_ecs_task_definition.ops : td.skip_destroy && !td.track_latest])
    error_message = "task definitions keep old revisions and read their own"
  }

  assert {
    condition     = aws_ecs_service.main.alarms[0].enable && aws_ecs_service.main.alarms[0].rollback && toset(aws_ecs_service.main.alarms[0].alarm_names) == toset(["satis-prod-backend-critical", "satis-prod-backend-errors"])
    error_message = "the service rolls back on backend-critical or backend-errors"
  }
}

run "github_repository_must_be_owner_slash_repo" {
  command = plan

  variables {
    github_repository = "Sour-Dev-Home/satisfactory-dash/extra"
  }

  expect_failures = [var.github_repository]
}
