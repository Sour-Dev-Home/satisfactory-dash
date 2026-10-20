# CloudWatch alarms to the owner's email (#501). Four alarms, inside the free tier (10 alarms); SNS email is
# free for the first 1,000 notifications a month. No new AWS service beyond SNS and CloudWatch.
# Every alarm mails on ALARM and again on OK. The address is var.alarm_email (git-ignored tfvars).

resource "aws_sns_topic" "alarms" {
  name = "satis-${local.environment}-alarms"
}

# The subscription stays "pending" until the owner clicks the confirmation link AWS mails (runbooks/aws.md).
resource "aws_sns_topic_subscription" "alarms_email" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

locals {
  alarm_actions = [aws_sns_topic.alarms.arn]
}

# ECS: no running backend task. Container Insights is off (ecs.tf), so the RunningTaskCount metric does not
# exist; the free AWS/ECS CPUUtilization metric is only published while a task runs. With missing data
# treated as breaching, SampleCount < 1 for N periods means "no task is running": the service is down or
# in a crash loop (a task that dies within a minute leaves the same gaps). Scaling to 0 on purpose trips it.
resource "aws_cloudwatch_metric_alarm" "ecs_no_running_task" {
  alarm_name          = "satis-${local.environment}-ecs-no-running-task"
  alarm_description   = "The backend service has published no CPU data, so no task is running (down or crash-looping). runbooks/aws.md, Alarms."
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  dimensions          = { ClusterName = aws_ecs_cluster.main.name, ServiceName = aws_ecs_service.main.name }
  statistic           = "SampleCount"
  comparison_operator = "LessThanThreshold"
  threshold           = var.alarms.ecs_running_tasks_min
  period              = var.alarms.ecs_period_seconds
  evaluation_periods  = var.alarms.ecs_evaluation_periods
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

# RDS: free storage low (the instance has 20 GB and no autoscaling, rds.tf).
resource "aws_cloudwatch_metric_alarm" "rds_free_storage" {
  alarm_name          = "satis-${local.environment}-rds-free-storage-low"
  alarm_description   = "RDS free storage is low and the disk does not grow by itself. runbooks/aws.md, Alarms."
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  statistic           = "Minimum"
  comparison_operator = "LessThanThreshold"
  threshold           = var.alarms.rds_free_storage_min_gib * 1073741824
  period              = var.alarms.rds_storage_period
  evaluation_periods  = 1
  treat_missing_data  = "missing"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

# RDS: CPU high for a sustained period (a t4g.micro has CPU credits; sustained load drains them).
resource "aws_cloudwatch_metric_alarm" "rds_cpu_high" {
  alarm_name          = "satis-${local.environment}-rds-cpu-high"
  alarm_description   = "RDS CPU has stayed high for several periods in a row. runbooks/aws.md, Alarms."
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  statistic           = "Average"
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.alarms.rds_cpu_max_percent
  period              = var.alarms.rds_cpu_period_seconds
  evaluation_periods  = var.alarms.rds_cpu_evaluation
  treat_missing_data  = "missing"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

# Backend: error-level pino lines. Pino writes JSON with a numeric level (error = 50, fatal = 60).
resource "aws_cloudwatch_log_metric_filter" "backend_errors" {
  name           = "satis-${local.environment}-backend-errors"
  log_group_name = aws_cloudwatch_log_group.backend.name
  pattern        = "{ $.level >= 50 }"

  metric_transformation {
    name          = "BackendErrorLines"
    namespace     = "Satis/${local.environment}"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "backend_errors" {
  alarm_name          = "satis-${local.environment}-backend-errors"
  alarm_description   = "The backend logged error-level lines above the threshold. runbooks/aws.md, Alarms."
  namespace           = "Satis/${local.environment}"
  metric_name         = aws_cloudwatch_log_metric_filter.backend_errors.metric_transformation[0].name
  statistic           = "Sum"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = var.alarms.backend_errors_max
  period              = var.alarms.backend_errors_period
  evaluation_periods  = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}
