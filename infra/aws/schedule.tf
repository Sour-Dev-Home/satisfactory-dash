# The nightly backup (ADR-0034 §3, ADR-0035): EventBridge Scheduler starts the backup task (ops.tf) as
# a one-off Fargate task, on the service's subnets and task group (the one RDS lets in). Scheduler
# retries only a failed start; a backup that starts and fails is the heartbeat's job
# (backup_heartbeat_enabled), as on the compose host.

resource "aws_scheduler_schedule" "backup" {
  name                         = "satis-${local.environment}-backup"
  description                  = "Nightly encrypted pg_dump to Backblaze B2"
  schedule_expression          = var.backup_schedule
  schedule_expression_timezone = "UTC"
  state                        = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_ecs_cluster.main.arn
    role_arn = aws_iam_role.backup_scheduler.arn

    ecs_parameters {
      task_definition_arn = aws_ecs_task_definition.ops["backup"].arn
      launch_type         = "FARGATE"
      task_count          = 1

      # A public IP for egress only (no NAT gateway), as for the service; the group has no inbound rule.
      network_configuration {
        subnets          = aws_subnet.public[*].id
        security_groups  = [aws_security_group.task.id]
        assign_public_ip = true
      }
    }

    retry_policy {
      maximum_event_age_in_seconds = 3600
      maximum_retry_attempts       = 2
    }
  }
}
