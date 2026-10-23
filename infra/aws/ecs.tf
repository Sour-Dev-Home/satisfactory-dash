# ADR-0034 §2 (#408): the backend and cloudflared as one Fargate ARM task, 0.5 vCPU / 1 GB. No load
# balancer and no inbound rule: cloudflared dials out to Cloudflare and reaches the backend over the
# task's shared loopback (decision D2, the same shape as compose.yaml's `network_mode: service:backend`).

locals {
  # cloudflared 2026.10.1 by its multi-arch index digest, the same pin as compose.yaml (a static test
  # keeps the two equal).
  cloudflared_image = "cloudflare/cloudflared:2026.10.1@sha256:a15a3b50b8dabd57ac2090e9484c0247dba9dfa1f0df4d298d4317f9d69eb2d5"

  # compose.yaml's `:?` keys: the backend refuses to start without them.
  backend_required_secrets = ["DATABASE_URL", "DASHBOARD_ADMIN_USER", "DASHBOARD_ADMIN_PASSWORD_HASH", "SESSION_SECRET"]
  # The rest of the backend's SSM keys, injected only when listed in var.backend_optional_secrets (a
  # test keeps both lists inside ssm.tf's names).
  backend_optional_secret_keys = [
    "SERVER_SECRETS_KEY", "SERVER_SECRETS_KEY_ID", "SERVER_SECRETS_PREVIOUS_KEYS",
    "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "BOOTSTRAP_OWNER_EMAIL",
  ]
  backend_secret_keys = distinct(concat(local.backend_required_secrets, var.backend_optional_secrets))
  task_secret_keys    = concat(local.backend_secret_keys, ["TUNNEL_TOKEN"])

  # The runtime image has node but no curl (backend/Dockerfile). Liveness, not compose.yaml's readiness
  # probe (#425): /ready fails while RDS restarts, and ECS would replace a healthy task. An external
  # uptime monitor watches /api/health/ready instead (runbooks/aws.md).
  backend_health_probe = "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.status===200?0:1),()=>process.exit(1))"
}

resource "aws_ecs_cluster" "main" {
  name = "satis-${local.environment}"

  # Off: its metrics cost extra and the app logs to stdout already (ADR-0034, ADR-0037).
  setting {
    name  = "containerInsights"
    value = "disabled"
  }
}

resource "aws_ecs_task_definition" "main" {
  family                   = "satis-${local.environment}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"

  # ADR-0049 D2: this revision is the base CI copies. Terraform reads its own revision, not the newest
  # in the family (CI registers those), and a config change never deregisters one a rollback may need.
  track_latest = false
  skip_destroy = true

  # No task role: nothing in the app calls AWS (ADR-0034 §3), so the containers get no credentials.
  execution_role_arn = aws_iam_role.execution.arn

  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    {
      name      = "backend"
      image     = var.backend_image
      essential = true
      # Loopback only: cloudflared, in the same task, is the one peer (backend/src/platform/clientIp.ts).
      environment = concat(
        [{ name = "HOST", value = "127.0.0.1" }],
        [for k in sort(keys(var.backend_environment)) : { name = k, value = var.backend_environment[k] }],
      )
      secrets = [for k in local.backend_secret_keys : { name = k, valueFrom = local.ssm_parameter_arns[k] }]
      healthCheck = {
        command     = ["CMD", "node", "-e", local.backend_health_probe]
        interval    = 10
        timeout     = 5
        retries     = 6
        startPeriod = 30
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.backend.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "backend"
        }
      }
    },
    {
      name      = "cloudflared"
      image     = local.cloudflared_image
      essential = true
      # HEALTHY is liveness (#425): the tunnel connects once the process is up, possibly before the
      # database answers, and /api/health/ready returns 503 until it does.
      dependsOn = [{ containerName = "backend", condition = "HEALTHY" }]
      # Metrics on loopback only, as in compose.yaml.
      command = ["tunnel", "--no-autoupdate", "--metrics", "127.0.0.1:20241", "run"]
      # The origin when the tunnel has no ingress rules of its own; the dashboard route must name the
      # same URL (as in compose.yaml). 127.0.0.1, never localhost, which can resolve to IPv6 first.
      environment = [{ name = "TUNNEL_URL", value = "http://127.0.0.1:3001" }]
      secrets     = [{ name = "TUNNEL_TOKEN", valueFrom = local.ssm_parameter_arns["TUNNEL_TOKEN"] }]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.cloudflared.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "cloudflared"
        }
      }
    },
  ])
}

resource "aws_ecs_service" "main" {
  name            = "satis-${local.environment}"
  cluster         = aws_ecs_cluster.main.arn
  task_definition = aws_ecs_task_definition.main.arn
  launch_type     = "FARGATE"
  desired_count   = 1

  # One backend at a time (ADR-0010: in-process rate limits and pollers assume a single instance), so
  # a deploy stops the old task before starting the new one. A new task that never turns healthy trips
  # the circuit breaker, which rolls the service back to the last good task definition.
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # ADR-0049 D5, the second net beside the circuit breaker: either alarm in ALARM during a deployment
  # fails it and rolls back to the last completed one. ECS ignores an alarm already in ALARM when the
  # deployment starts, so the deploy workflow checks both first.
  alarms {
    alarm_names = [aws_cloudwatch_metric_alarm.backend_critical.alarm_name, aws_cloudwatch_metric_alarm.backend_errors.alarm_name]
    enable      = true
    rollback    = true
  }

  # The public IP is for egress only (no NAT gateway); the task group has no inbound rules.
  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = true
  }

  enable_execute_command = false
  propagate_tags         = "SERVICE"

  # `terraform apply` waits for the service to be steady, so a rollback shows up as a failed apply.
  wait_for_steady_state = true

  # ADR-0049 D2: Terraform owns the configuration, CI owns which image runs. A plan stays clean after a
  # CI rollout, and an apply never rolls an image back. A new base reaches the service at the next
  # deploy (runbooks/aws.md, "Deploy").
  lifecycle {
    ignore_changes = [task_definition]
  }
}
