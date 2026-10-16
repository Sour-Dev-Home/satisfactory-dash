# `terraform test` for the AWS base (#405). A mock provider stands in for AWS, so this needs no
# credentials and touches no account; `apply` here only fills computed attributes with fake values.

mock_provider "aws" {
  # The provider checks these are ARNs, so the mock's random strings won't do (#408).
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::123456789012:role/satis-prod-ecs-execution" }
  }
  mock_resource "aws_ecs_cluster" {
    defaults = { arn = "arn:aws:ecs:us-east-1:123456789012:cluster/satis-prod" }
  }
  mock_resource "aws_ecs_task_definition" {
    defaults = { arn = "arn:aws:ecs:us-east-1:123456789012:task-definition/satis-prod:1" }
  }
  # The ops tasks (#409) read the master secret's ARN, which a real RDS instance always has.
  mock_resource "aws_db_instance" {
    defaults = { master_user_secret = [{ secret_arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:rds!db-mock", kms_key_id = "", secret_status = "active" }] }
  }
}

variables {
  budget_alert_email = "alerts@example.com"
  backend_image      = "ghcr.io/sour-dev-home/satisfactory-dash-backend@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  ops_image          = "ghcr.io/sour-dev-home/satisfactory-dash-ops@sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"
  backup_b2          = { bucket = "example-bucket", endpoint = "https://s3.example-region.backblazeb2.com", region = "example-region" }
}

run "network_is_public_subnets_without_nat" {
  command = apply

  assert {
    condition     = length(aws_subnet.public) == 2 && length(distinct([for s in aws_subnet.public : s.availability_zone])) == 2
    error_message = "two public subnets in two AZs (RDS needs a subnet group across two AZs)"
  }

  assert {
    condition     = alltrue([for r in aws_route_table.public.route : r.cidr_block == "0.0.0.0/0" && r.gateway_id == aws_internet_gateway.main.id && r.nat_gateway_id == null])
    error_message = "the only route out is the internet gateway, never a NAT gateway"
  }

  assert {
    condition     = length(aws_route_table_association.public) == 2
    error_message = "both subnets use the public route table"
  }
}

run "task_security_group_has_no_inbound_rules" {
  command = apply

  assert {
    condition     = length(aws_security_group.task.ingress) == 0
    error_message = "the task security group takes no inbound traffic"
  }

  assert {
    condition     = length(aws_security_group.task.egress) == 1
    error_message = "the task security group has one outbound rule (cloudflared, ECR, SSM, RDS)"
  }

  assert {
    condition     = length(aws_default_security_group.main.ingress) == 0 && length(aws_default_security_group.main.egress) == 0
    error_message = "the VPC's default security group is emptied, so nothing falls back to it"
  }
}

run "rds_matches_adr_0034" {
  command = apply

  assert {
    condition     = aws_db_instance.main.engine == "postgres" && startswith(aws_db_instance.main.engine_version, "18")
    error_message = "PostgreSQL 18"
  }

  assert {
    condition     = aws_db_instance.main.instance_class == "db.t4g.micro" && aws_db_instance.main.multi_az == false
    error_message = "db.t4g.micro, single-AZ"
  }

  assert {
    condition     = aws_db_instance.main.allocated_storage == 20 && aws_db_instance.main.storage_type == "gp3" && aws_db_instance.main.max_allocated_storage == 0
    error_message = "20 GB gp3, with no storage autoscaling to spend credits"
  }

  assert {
    condition     = aws_db_instance.main.publicly_accessible == false && aws_db_instance.main.storage_encrypted == true
    error_message = "not publicly accessible, encrypted at rest"
  }

  assert {
    condition     = aws_db_instance.main.backup_retention_period == 7
    error_message = "7-day automated backups"
  }

  assert {
    condition     = aws_db_instance.main.manage_master_user_password == true && aws_db_instance.main.password == null
    error_message = "the master password lives in Secrets Manager, never in state"
  }

  assert {
    condition     = aws_db_instance.main.vpc_security_group_ids == toset([aws_security_group.rds.id])
    error_message = "RDS sits in its own security group only"
  }

  assert {
    condition     = aws_db_subnet_group.main.subnet_ids == toset([for s in aws_subnet.public : s.id]) && aws_db_instance.main.db_subnet_group_name == aws_db_subnet_group.main.name
    error_message = "RDS uses the VPC's subnets"
  }
}

run "rds_is_reachable_only_from_the_task_group" {
  command = apply

  assert {
    condition     = length(aws_security_group.rds.ingress) == 1
    error_message = "one inbound rule on the database group"
  }

  assert {
    condition = alltrue([for r in aws_security_group.rds.ingress :
      r.from_port == 5432 && r.to_port == 5432 && r.protocol == "tcp" &&
      r.security_groups == toset([aws_security_group.task.id]) &&
      length(r.cidr_blocks) == 0 && length(r.ipv6_cidr_blocks) == 0 && length(r.prefix_list_ids) == 0 && !r.self
    ])
    error_message = "PostgreSQL from the task security group only, never a CIDR"
  }

  assert {
    condition     = length(aws_security_group.rds.egress) == 0
    error_message = "the database opens no outbound connections"
  }
}

run "ssm_names_not_values" {
  command = apply

  assert {
    condition     = alltrue([for n in values(output.ssm_parameter_names) : startswith(n, "/satis/prod/")])
    error_message = "every parameter is under /satis/prod/"
  }

  assert {
    condition = alltrue([for k in ["TUNNEL_TOKEN", "B2_ACCESS_KEY_ID", "B2_SECRET_ACCESS_KEY", "BACKUP_HEARTBEAT_URL", "SESSION_SECRET", "DASHBOARD_ADMIN_PASSWORD_HASH", "DB_APP_PASSWORD"] :
    contains(keys(output.ssm_parameter_names), k)])
    error_message = "the tunnel token, the B2 keys, the heartbeat URL and the app secrets are named"
  }

  assert {
    condition     = alltrue([for k, arn in output.ssm_parameter_arns : endswith(arn, ":parameter${output.ssm_parameter_names[k]}")])
    error_message = "each ARN points at its own name, for the ECS task role's policy"
  }

  assert {
    condition     = length(output.ssm_parameter_names) == length(output.ssm_parameter_arns)
    error_message = "one ARN per name"
  }
}

run "budget_alerts_on_gross_spend" {
  command = apply

  assert {
    condition     = aws_budgets_budget.monthly.budget_type == "COST" && aws_budgets_budget.monthly.time_unit == "MONTHLY"
    error_message = "a monthly cost budget"
  }

  assert {
    condition     = aws_budgets_budget.monthly.cost_types[0].include_credit == false
    error_message = "credits are excluded, so the budget tracks what the credits pay for (net spend stays $0 on the Free plan)"
  }

  assert {
    condition     = length(aws_budgets_budget.monthly.notification) == 2 && alltrue([for n in aws_budgets_budget.monthly.notification : n.subscriber_email_addresses == toset([var.budget_alert_email])])
    error_message = "an actual and a forecast alert, both to the given address"
  }
}

run "budget_email_is_validated" {
  command = plan

  variables {
    budget_alert_email = "not-an-email"
  }

  expect_failures = [var.budget_alert_email]
}

run "budget_limit_must_be_positive" {
  command = plan

  variables {
    monthly_budget_usd = 0
  }

  expect_failures = [var.monthly_budget_usd]
}

run "edge_one_availability_zone_is_refused" {
  command = plan

  variables {
    availability_zones = ["us-east-1a"]
  }

  expect_failures = [var.availability_zones]
}

run "edge_duplicate_availability_zones_are_refused" {
  command = plan

  variables {
    availability_zones = ["us-east-1a", "us-east-1a"]
  }

  expect_failures = [var.availability_zones]
}

run "edge_malformed_vpc_cidr_is_refused" {
  command = plan

  variables {
    vpc_cidr = "10.40.0.0"
  }

  expect_failures = [var.vpc_cidr]
}

run "edge_budget_email_with_spaces_is_refused" {
  command = plan

  variables {
    budget_alert_email = "a b@example.com"
  }

  expect_failures = [var.budget_alert_email]
}

run "edge_fractional_budget_is_formatted_for_aws" {
  command = apply

  variables {
    monthly_budget_usd = 33.5
  }

  assert {
    condition     = aws_budgets_budget.monthly.limit_amount == "33.50"
    error_message = "the limit goes to AWS as a two-decimal string"
  }
}
