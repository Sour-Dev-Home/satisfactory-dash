# `terraform test` for the ECS Fargate service with the cloudflared sidecar (#408). Same mock provider
# as base.tftest.hcl: no credentials, no account, and `apply` only fills computed attributes.

mock_provider "aws" {
  # The provider checks these are ARNs, so the mock's random strings won't do.
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::123456789012:role/satis-prod-ecs-execution" }
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
    defaults = { arn = "arn:aws:logs:us-east-1:123456789012:log-group:/ecs/satis-prod/mock" }
  }
  # The ops tasks (#409) read the master secret's ARN, which a real RDS instance always has.
  mock_resource "aws_db_instance" {
    defaults = { master_user_secret = [{ secret_arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:rds!db-mock", kms_key_id = "", secret_status = "active" }] }
  }
}

variables {
  budget_alert_email = "alerts@example.com"
  alarm_email        = "alarms@example.com"
  backend_image      = "ghcr.io/sour-dev-home/satisfactory-dash-backend@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  ops_image          = "ghcr.io/sour-dev-home/satisfactory-dash-ops@sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"
  backup_b2          = { bucket = "example-bucket", endpoint = "https://s3.example-region.backblazeb2.com", region = "example-region" }
}

run "criterion_1_task_is_arm64_half_vcpu_one_gb_with_two_essential_containers" {
  command = apply

  assert {
    condition     = aws_ecs_task_definition.main.cpu == "512" && aws_ecs_task_definition.main.memory == "1024"
    error_message = "0.5 vCPU and 1 GB"
  }

  assert {
    condition     = one(aws_ecs_task_definition.main.runtime_platform).cpu_architecture == "ARM64" && one(aws_ecs_task_definition.main.runtime_platform).operating_system_family == "LINUX"
    error_message = "Fargate on ARM64 Linux"
  }

  assert {
    condition     = aws_ecs_task_definition.main.requires_compatibilities == toset(["FARGATE"]) && aws_ecs_task_definition.main.network_mode == "awsvpc"
    error_message = "a Fargate task in awsvpc mode, so both containers share one loopback"
  }

  assert {
    condition     = length(jsondecode(aws_ecs_task_definition.main.container_definitions)) == 2 && alltrue([for c in jsondecode(aws_ecs_task_definition.main.container_definitions) : c.essential])
    error_message = "two containers, both essential, so either one stopping replaces the task"
  }

  assert {
    condition     = sort([for c in jsondecode(aws_ecs_task_definition.main.container_definitions) : c.name]) == tolist(["backend", "cloudflared"])
    error_message = "the containers are backend and cloudflared"
  }

  assert {
    condition     = aws_ecs_cluster.main.name == aws_ecs_service.main.cluster || aws_ecs_cluster.main.arn == aws_ecs_service.main.cluster
    error_message = "the service runs in the cluster"
  }
}

run "criterion_1_backend_uses_the_digest_and_listens_on_loopback" {
  command = apply

  assert {
    condition     = [for c in jsondecode(aws_ecs_task_definition.main.container_definitions) : c.image if c.name == "backend"][0] == var.backend_image
    error_message = "the backend image is the digest variable"
  }

  assert {
    condition     = contains([for c in jsondecode(aws_ecs_task_definition.main.container_definitions) : c.environment if c.name == "backend"][0], { name = "HOST", value = "127.0.0.1" })
    error_message = "HOST=127.0.0.1: the backend is reachable only from inside the task"
  }

  assert {
    condition     = length(lookup([for c in jsondecode(aws_ecs_task_definition.main.container_definitions) : c if c.name == "backend"][0], "portMappings", [])) == 0
    error_message = "no port mapping: nothing outside the task reaches the backend"
  }
}

run "criterion_1_cloudflared_is_pinned_waits_for_a_healthy_backend_and_targets_loopback" {
  command = apply

  assert {
    condition     = can(regex("^cloudflare/cloudflared:[0-9]{4}\\.[0-9]+\\.[0-9]+@sha256:[0-9a-f]{64}$", [for c in jsondecode(aws_ecs_task_definition.main.container_definitions) : c.image if c.name == "cloudflared"][0]))
    error_message = "cloudflared is pinned by version and digest"
  }

  assert {
    condition     = [for c in jsondecode(aws_ecs_task_definition.main.container_definitions) : c.dependsOn if c.name == "cloudflared"][0] == [{ containerName = "backend", condition = "HEALTHY" }]
    error_message = "cloudflared starts only once the backend is HEALTHY"
  }

  assert {
    condition     = contains([for c in jsondecode(aws_ecs_task_definition.main.container_definitions) : c.environment if c.name == "cloudflared"][0], { name = "TUNNEL_URL", value = "http://127.0.0.1:3001" })
    error_message = "the tunnel's origin is http://127.0.0.1:3001"
  }

  assert {
    condition     = [for s in [for c in jsondecode(aws_ecs_task_definition.main.container_definitions) : c.secrets if c.name == "cloudflared"][0] : s.name] == ["TUNNEL_TOKEN"]
    error_message = "cloudflared gets the tunnel token and nothing else from SSM"
  }
}

run "criterion_2_backend_health_check_is_node_fetching_liveness" {
  command = apply

  assert {
    condition     = slice([for c in jsondecode(aws_ecs_task_definition.main.container_definitions) : c.healthCheck.command if c.name == "backend"][0], 0, 3) == ["CMD", "node", "-e"]
    error_message = "the health check runs node -e (the image has no curl)"
  }

  assert {
    condition     = strcontains([for c in jsondecode(aws_ecs_task_definition.main.container_definitions) : c.healthCheck.command if c.name == "backend"][0][3], "fetch('http://127.0.0.1:3001/api/health')")
    error_message = "the health check fetches http://127.0.0.1:3001/api/health (liveness, #425)"
  }

  assert {
    condition     = !strcontains([for c in jsondecode(aws_ecs_task_definition.main.container_definitions) : c.healthCheck.command if c.name == "backend"][0][3], "/api/health/ready")
    error_message = "the health check does not use /api/health/ready, which fails while RDS restarts (#425)"
  }

  assert {
    condition     = [for c in jsondecode(aws_ecs_task_definition.main.container_definitions) : [c.healthCheck.interval, c.healthCheck.retries, c.healthCheck.startPeriod] if c.name == "backend"][0] == [10, 6, 30]
    error_message = "interval, retries and start period are unchanged (#425)"
  }
}

run "criterion_3_one_task_public_ip_for_egress_and_circuit_breaker_rollback" {
  command = apply

  assert {
    condition     = aws_ecs_service.main.desired_count == 1 && aws_ecs_service.main.launch_type == "FARGATE"
    error_message = "one Fargate task"
  }

  assert {
    condition     = one(aws_ecs_service.main.network_configuration).assign_public_ip == true
    error_message = "a public IP, for egress (no NAT gateway)"
  }

  assert {
    condition     = one(aws_ecs_service.main.network_configuration).security_groups == toset([aws_security_group.task.id]) && one(aws_ecs_service.main.network_configuration).subnets == toset([for s in aws_subnet.public : s.id])
    error_message = "the task group (no inbound rules) in the public subnets"
  }

  assert {
    condition     = length(aws_ecs_service.main.load_balancer) == 0
    error_message = "no load balancer: the tunnel is the only way in"
  }

  assert {
    condition     = one(aws_ecs_service.main.deployment_circuit_breaker).enable == true && one(aws_ecs_service.main.deployment_circuit_breaker).rollback == true
    error_message = "the deployment circuit breaker rolls a bad deploy back"
  }
}

# ADR-0054 D3: the new task starts and turns healthy before the old one stops, so a deploy keeps a tunnel connector.
run "adr_0054_overlap_rollout_keeps_the_old_task_until_the_new_one_is_healthy" {
  command = apply

  assert {
    condition     = aws_ecs_service.main.deployment_minimum_healthy_percent == 100 && aws_ecs_service.main.deployment_maximum_percent == 200
    error_message = "the overlap rollout: 100% healthy minimum, 200% maximum (ADR-0054 D3)"
  }

  assert {
    condition     = aws_ecs_service.main.desired_count == 1
    error_message = "still one task outside a deploy: the overlap is two tasks for about a minute, not two always"
  }
}

run "criterion_4_execution_role_reads_only_satis_prod_and_injects_secrets" {
  command = apply

  assert {
    condition = alltrue(flatten([for s in jsondecode(aws_iam_role_policy.execution.policy).Statement :
      [for r in flatten([s.Resource]) : strcontains(r, ":parameter/satis/prod/")] if contains(flatten([s.Action]), "ssm:GetParameters")
    ]))
    error_message = "ssm:GetParameters on /satis/prod/* parameters only"
  }

  assert {
    condition = alltrue([for s in jsondecode(aws_iam_role_policy.execution.policy).Statement :
      alltrue([for a in flatten([s.Action]) : contains(["ssm:GetParameters", "logs:CreateLogStream", "logs:PutLogEvents"], a)])
    ])
    error_message = "the execution role reads parameters and writes its logs, nothing else"
  }

  assert {
    condition     = alltrue([for s in jsondecode(aws_iam_role_policy.execution.policy).Statement : !strcontains(jsonencode(s.Resource), "\"*\"")])
    error_message = "no statement on every resource"
  }

  assert {
    condition     = aws_ecs_task_definition.main.execution_role_arn == aws_iam_role.execution.arn && aws_ecs_task_definition.main.task_role_arn == null
    error_message = "an execution role, and no task role: the containers get no AWS credentials"
  }

  assert {
    condition = alltrue(flatten([for c in jsondecode(aws_ecs_task_definition.main.container_definitions) :
      [for s in c.secrets : s.valueFrom == local.ssm_parameter_arns[s.name]]
    ]))
    error_message = "every secret is injected from its own /satis/prod/ parameter"
  }

  assert {
    condition     = sort([for s in [for c in jsondecode(aws_ecs_task_definition.main.container_definitions) : c.secrets if c.name == "backend"][0] : s.name]) == sort(["DATABASE_URL", "DASHBOARD_ADMIN_USER", "DASHBOARD_ADMIN_PASSWORD_HASH", "SESSION_SECRET"])
    error_message = "by default the backend gets its four required secrets"
  }

  assert {
    condition = toset(flatten([for s in jsondecode(aws_iam_role_policy.execution.policy).Statement : flatten([s.Resource]) if contains(flatten([s.Action]), "ssm:GetParameters")])) == toset(flatten([
      for c in jsondecode(aws_ecs_task_definition.main.container_definitions) : [for s in c.secrets : s.valueFrom]
    ]))
    error_message = "the role reads exactly the parameters the task injects"
  }
}

run "criterion_4_execution_role_trusts_ecs_tasks_in_this_account_only" {
  command = apply

  assert {
    condition     = jsondecode(aws_iam_role.execution.assume_role_policy).Statement[0].Principal.Service == "ecs-tasks.amazonaws.com"
    error_message = "only ECS tasks assume the execution role"
  }

  assert {
    condition     = jsondecode(aws_iam_role.execution.assume_role_policy).Statement[0].Condition.StringEquals["aws:SourceAccount"] == data.aws_caller_identity.current.account_id
    error_message = "only for tasks in this account (confused deputy)"
  }
}

run "criterion_5_logs_keep_14_days_and_container_insights_is_off" {
  command = apply

  assert {
    condition     = aws_cloudwatch_log_group.backend.retention_in_days == 14 && aws_cloudwatch_log_group.cloudflared.retention_in_days == 14
    error_message = "both log groups keep 14 days (the privacy page's promise)"
  }

  assert {
    condition     = [for s in aws_ecs_cluster.main.setting : s.value if s.name == "containerInsights"] == ["disabled"]
    error_message = "Container Insights is off"
  }

  assert {
    condition = alltrue([for c in jsondecode(aws_ecs_task_definition.main.container_definitions) :
      c.logConfiguration.logDriver == "awslogs" && contains([aws_cloudwatch_log_group.backend.name, aws_cloudwatch_log_group.cloudflared.name], c.logConfiguration.options["awslogs-group"])
    ])
    error_message = "each container logs to its own 14-day group"
  }
}

run "edge_optional_backend_secrets_are_opt_in" {
  command = apply

  variables {
    backend_optional_secrets = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]
  }

  assert {
    condition     = length([for s in [for c in jsondecode(aws_ecs_task_definition.main.container_definitions) : c.secrets if c.name == "backend"][0] : s if contains(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], s.name)]) == 2
    error_message = "an opted-in optional secret is injected"
  }
}

run "edge_a_tag_image_is_refused" {
  command = plan

  variables {
    backend_image = "ghcr.io/sour-dev-home/satisfactory-dash-backend:main"
  }

  expect_failures = [var.backend_image]
}

run "edge_a_short_digest_is_refused" {
  command = plan

  variables {
    backend_image = "ghcr.io/sour-dev-home/satisfactory-dash-backend@sha256:0123abcd"
  }

  expect_failures = [var.backend_image]
}

run "edge_an_unknown_optional_secret_is_refused" {
  command = plan

  variables {
    backend_optional_secrets = ["B2_SECRET_ACCESS_KEY"]
  }

  expect_failures = [var.backend_optional_secrets]
}

run "edge_extra_environment_cannot_override_host_or_hold_a_secret_name" {
  command = plan

  variables {
    backend_environment = { HOST = "0.0.0.0" }
  }

  expect_failures = [var.backend_environment]
}

run "edge_extra_environment_is_passed_through" {
  command = apply

  variables {
    backend_environment = { FRONTEND_ORIGIN = "https://satis-manager.com" }
  }

  assert {
    condition     = contains([for c in jsondecode(aws_ecs_task_definition.main.container_definitions) : c.environment if c.name == "backend"][0], { name = "FRONTEND_ORIGIN", value = "https://satis-manager.com" })
    error_message = "plain settings reach the backend as environment variables"
  }
}

run "hunter_execution_policy_is_not_vacuous" {
  command = apply

  assert {
    condition     = length([for s in jsondecode(aws_iam_role_policy.execution.policy).Statement : s if contains(flatten([s.Action]), "ssm:GetParameters")]) == 1 && length(flatten([for s in jsondecode(aws_iam_role_policy.execution.policy).Statement : s.Resource if contains(flatten([s.Action]), "ssm:GetParameters")])) == 5
    error_message = "exactly one ssm statement, naming the four required secrets and the tunnel token (the alltrue checks above would pass on an empty list)"
  }

  assert {
    condition     = alltrue([for s in jsondecode(aws_iam_role_policy.execution.policy).Statement : alltrue([for r in flatten([s.Resource]) : endswith(r, ":log-stream:*")]) if contains(flatten([s.Action]), "logs:PutLogEvents")]) && length(flatten([for s in jsondecode(aws_iam_role_policy.execution.policy).Statement : s.Resource if contains(flatten([s.Action]), "logs:PutLogEvents")])) == 2
    error_message = "log writes are scoped to the two groups' log streams"
  }
}

run "edge_backend_secret_lists_stay_inside_the_ssm_names" {
  command = plan

  assert {
    condition     = alltrue([for k in concat(local.backend_required_secrets, local.backend_optional_secret_keys) : contains(local.ssm_secret_keys, k)])
    error_message = "every backend secret, required or optional, is a name in ssm.tf"
  }
}

run "edge_extra_environment_refuses_a_secret_looking_name" {
  command = plan

  variables {
    backend_environment = { STRIPE_API_KEY = "sk_live_placeholder" }
  }

  expect_failures = [var.backend_environment]
}
