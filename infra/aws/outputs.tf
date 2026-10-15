output "vpc_id" {
  description = "The VPC the ECS service runs in."
  value       = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "Subnets for the ECS service (with assign_public_ip, since there is no NAT gateway)."
  value       = aws_subnet.public[*].id
}

output "task_security_group_id" {
  description = "The ECS task's security group: outbound only."
  value       = aws_security_group.task.id
}

output "db_endpoint" {
  description = "RDS host:port, for DATABASE_URL in SSM."
  value       = aws_db_instance.main.endpoint
}

output "db_master_user_secret_arn" {
  description = "The Secrets Manager secret RDS keeps the master password in (the ARN, never the value)."
  value       = try(aws_db_instance.main.master_user_secret[0].secret_arn, null)
}

output "ssm_parameter_names" {
  description = "Environment variable name => SSM parameter name; values are set by hand, never by Terraform."
  value       = local.ssm_parameter_names
}

output "ssm_parameter_arns" {
  description = "Environment variable name => SSM parameter ARN, for the task execution role."
  value       = local.ssm_parameter_arns
}

output "ecs_cluster_name" {
  description = "The ECS cluster, for `aws ecs` commands (logs, service events, a forced redeploy)."
  value       = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  description = "The backend + cloudflared service."
  value       = aws_ecs_service.main.name
}

output "log_group_names" {
  description = "The 14-day CloudWatch log groups, by container."
  value       = { backend = aws_cloudwatch_log_group.backend.name, cloudflared = aws_cloudwatch_log_group.cloudflared.name }
}
