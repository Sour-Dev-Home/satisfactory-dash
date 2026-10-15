# CloudWatch Logs for the ECS task (ADR-0034 §2). 14 days is the privacy page's promise
# (docs-vault/wiki/legal/privacy-terms-outline.md); Container Insights stays off (ecs.tf).

resource "aws_cloudwatch_log_group" "backend" {
  name              = "/ecs/satis-${local.environment}/backend"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "cloudflared" {
  name              = "/ecs/satis-${local.environment}/cloudflared"
  retention_in_days = 14
}
