# The ECS task execution role (ADR-0034 §2): ECS uses it to read the task's /satis/prod/ parameters and
# write its logs, before and around the containers. It is never handed to the containers, and the task
# has no task role, so the app holds no AWS credentials at all, and no access key exists anywhere.
# Images come from GHCR, so it needs no ECR permission either. Policies are jsonencode'd, not data
# sources, so `terraform test` can check them against the mock provider.

resource "aws_iam_role" "execution" {
  name        = "satis-${local.environment}-ecs-execution"
  description = "ECS pulls the task's /satis/prod/ secrets and writes its logs"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
      # Only tasks in this account (the confused-deputy guard).
      Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } }
    }]
  })
}

resource "aws_iam_role_policy" "execution" {
  name = "satis-${local.environment}-ecs-execution"
  role = aws_iam_role.execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Exactly the parameters the task injects, all under /satis/prod/. SecureStrings under the
        # default aws/ssm key need no kms:Decrypt grant.
        Sid      = "ReadTaskSecrets"
        Effect   = "Allow"
        Action   = ["ssm:GetParameters"]
        Resource = sort(distinct([for k in local.task_secret_keys : local.ssm_parameter_arns[k]]))
      },
      {
        Sid      = "WriteTaskLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = ["${aws_cloudwatch_log_group.backend.arn}:log-stream:*", "${aws_cloudwatch_log_group.cloudflared.arn}:log-stream:*"]
      },
    ]
  })
}
