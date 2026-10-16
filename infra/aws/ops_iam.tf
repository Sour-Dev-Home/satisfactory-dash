# Execution roles for the ops tasks (ops.tf), one per task, so each reads only what it injects: the
# db-init role alone may read the RDS master secret (decision D4), and the restore role alone the
# per-run /satis/restore/ values. Like iam.tf: no managed policy, no task role, jsonencode'd policies
# so `terraform test` can check them. Secrets under the default aws/ssm and aws/secretsmanager keys
# need no kms:Decrypt grant.

resource "aws_iam_role" "ops_execution" {
  for_each = local.ops_tasks

  name        = "satis-${local.environment}-ops-${each.key}"
  description = "ECS pulls the ${each.key} task's secrets and writes its logs"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } }
    }]
  })
}

resource "aws_iam_role_policy" "ops_execution" {
  for_each = local.ops_tasks

  name = "satis-${local.environment}-ops-${each.key}"
  role = aws_iam_role.ops_execution[each.key].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [{
        Sid      = "ReadTaskParameters"
        Effect   = "Allow"
        Action   = ["ssm:GetParameters"]
        Resource = sort(distinct(values(each.value.ssm)))
      }],
      each.value.master_secret ? [{
        Sid      = "ReadRdsMasterSecret"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [local.db_master_secret_arn]
      }] : [],
      [{
        Sid      = "WriteTaskLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = ["${aws_cloudwatch_log_group.ops.arn}:log-stream:${each.key}/*"]
      }],
    )
  })
}

# EventBridge Scheduler's role for the nightly backup (schedule.tf): it may start the backup task
# definition in this cluster and hand ECS that task's execution role, nothing else.
resource "aws_iam_role" "backup_scheduler" {
  name        = "satis-${local.environment}-backup-scheduler"
  description = "EventBridge Scheduler starts the nightly backup task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } }
    }]
  })
}

resource "aws_iam_role_policy" "backup_scheduler" {
  name = "satis-${local.environment}-backup-scheduler"
  role = aws_iam_role.backup_scheduler.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "RunBackupTask"
        Effect    = "Allow"
        Action    = "ecs:RunTask"
        Resource  = ["${aws_ecs_task_definition.ops["backup"].arn_without_revision}:*"]
        Condition = { ArnEquals = { "ecs:cluster" = aws_ecs_cluster.main.arn } }
      },
      {
        Sid       = "PassBackupExecutionRole"
        Effect    = "Allow"
        Action    = "iam:PassRole"
        Resource  = [aws_iam_role.ops_execution["backup"].arn]
        Condition = { StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } }
      },
    ]
  })
}
