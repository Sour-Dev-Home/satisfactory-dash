# ADR-0049 D1 and D2 (PR 2): GitHub Actions deploys production through OIDC, so no AWS key is stored
# anywhere. The one role is assumable only by deploy.yml on main, in a job that names the `production`
# environment (main only). That environment has no required reviewer (owner answer 1, 2026-10-21): what
# merges to main reaches production, gated by the required checks, staging and the alarm rollback.
# deploy.yml must never be triggered by pull_request_target or workflow_call (security review, PR 2).

locals {
  deploy_arn_prefix = "arn:${data.aws_partition.current.partition}"
  deploy_account    = data.aws_caller_identity.current.account_id

  # GitHub's `sub` once the repository's OIDC subject template includes repo, context and
  # job_workflow_ref (runbooks/aws.md, "Deploy from GitHub"). StringEquals is case-sensitive: check it
  # against the first run's token [NEEDS VERIFICATION].
  prod_deploy_subject = "repo:${var.github_repository}:environment:production:job_workflow_ref:${var.github_repository}/.github/workflows/deploy.yml@refs/heads/main"

  # Plain, non-secret String parameters for CI (D2): the base revisions it copies, and the release record.
  deploy_parameter_prefix = "/satis/deploy/${local.environment}"
}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

resource "aws_iam_role" "prod_deploy" {
  name                 = "satis-${local.environment}-deploy"
  description          = "GitHub Actions deploy.yml on main, environment production (ADR-0049)"
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
          "token.actions.githubusercontent.com:sub" = local.prod_deploy_subject
        }
      }
    }]
  })
}

# Exactly D1's table; tests/deploy.tftest.hcl asserts every action list, with no wildcard action.
resource "aws_iam_role_policy" "prod_deploy" {
  name = "satis-${local.environment}-deploy"
  role = aws_iam_role.prod_deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # No resource-level permission for register; the AWS deploy action's own minimal policy uses *.
        Sid      = "TaskDefinitions"
        Effect   = "Allow"
        Action   = ["ecs:RegisterTaskDefinition", "ecs:DescribeTaskDefinition"]
        Resource = "*"
      },
      {
        Sid       = "RunMigrate"
        Effect    = "Allow"
        Action    = ["ecs:RunTask"]
        Resource  = "${local.deploy_arn_prefix}:ecs:${var.region}:${local.deploy_account}:task-definition/${aws_ecs_task_definition.ops["db-migrate"].family}:*"
        Condition = { ArnEquals = { "ecs:cluster" = aws_ecs_cluster.main.arn } }
      },
      {
        Sid       = "WatchMigrate"
        Effect    = "Allow"
        Action    = ["ecs:DescribeTasks"]
        Resource  = "${local.deploy_arn_prefix}:ecs:${var.region}:${local.deploy_account}:task/${aws_ecs_cluster.main.name}/*"
        Condition = { ArnEquals = { "ecs:cluster" = aws_ecs_cluster.main.arn } }
      },
      {
        Sid      = "RollOut"
        Effect   = "Allow"
        Action   = ["ecs:UpdateService", "ecs:DescribeServices"]
        Resource = "${local.deploy_arn_prefix}:ecs:${var.region}:${local.deploy_account}:service/${aws_ecs_cluster.main.name}/${aws_ecs_service.main.name}"
      },
      {
        Sid       = "PassExecutionRoles"
        Effect    = "Allow"
        Action    = ["iam:PassRole"]
        Resource  = [aws_iam_role.execution.arn, aws_iam_role.ops_execution["db-migrate"].arn]
        Condition = { StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } }
      },
      {
        Sid      = "WatchAlarms"
        Effect   = "Allow"
        Action   = ["cloudwatch:DescribeAlarms"]
        Resource = [aws_cloudwatch_metric_alarm.backend_errors.arn, aws_cloudwatch_metric_alarm.backend_critical.arn]
      },
      {
        Sid      = "ReadMigrateLog"
        Effect   = "Allow"
        Action   = ["logs:GetLogEvents"]
        Resource = "${aws_cloudwatch_log_group.ops.arn}:log-stream:db-migrate/*"
      },
      {
        Sid      = "ReadDeployRecord"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = "${local.deploy_arn_prefix}:ssm:${var.region}:${local.deploy_account}:parameter${local.deploy_parameter_prefix}/*"
      },
      {
        Sid      = "WriteRelease"
        Effect   = "Allow"
        Action   = ["ssm:PutParameter"]
        Resource = aws_ssm_parameter.deploy_released.arn
      },
    ]
  })
}

# The base revisions (D2): configuration as the owner last applied it. CI copies one, swaps the image
# and registers the copy, never "the newest in the family", which anyone allowed to register can add to.
resource "aws_ssm_parameter" "deploy_backend_task_definition" {
  name  = "${local.deploy_parameter_prefix}/backend-task-definition"
  type  = "String"
  value = aws_ecs_task_definition.main.arn
}

resource "aws_ssm_parameter" "deploy_migrate_task_definition" {
  name  = "${local.deploy_parameter_prefix}/migrate-task-definition"
  type  = "String"
  value = aws_ecs_task_definition.ops["db-migrate"].arn
}

# What production runs, written by CI after each good rollout ({ sha, backend, ops, taskDefinition,
# previous }); SSM keeps its last 100 versions as the release history. Terraform only creates it.
resource "aws_ssm_parameter" "deploy_released" {
  name  = "${local.deploy_parameter_prefix}/released"
  type  = "String"
  value = jsonencode({})

  lifecycle {
    ignore_changes = [value]
  }
}
