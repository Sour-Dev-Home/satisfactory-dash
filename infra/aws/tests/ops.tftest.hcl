# `terraform test` for the ops-image tasks, their roles and the nightly backup schedule (#409). Same mock
# provider as the other test files: no credentials, no account, and `apply` only fills computed attributes.

mock_provider "aws" {
  # The provider checks these are ARNs, so the mock's random strings won't do.
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::123456789012:role/satis-prod-mock" }
  }
  mock_resource "aws_ecs_cluster" {
    defaults = { arn = "arn:aws:ecs:us-east-1:123456789012:cluster/satis-prod" }
  }
  mock_resource "aws_ecs_task_definition" {
    defaults = {
      arn                  = "arn:aws:ecs:us-east-1:123456789012:task-definition/satis-prod-mock:1"
      arn_without_revision = "arn:aws:ecs:us-east-1:123456789012:task-definition/satis-prod-mock"
    }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:us-east-1:123456789012:log-group:/ecs/satis-prod/mock" }
  }
  # RDS keeps the master password in Secrets Manager; the mock names a fake secret.
  mock_resource "aws_db_instance" {
    defaults = {
      address            = "satis-prod.mock.us-east-1.rds.amazonaws.com"
      port               = 5432
      master_user_secret = [{ secret_arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:rds!db-mock", kms_key_id = "", secret_status = "active" }]
    }
  }
}

variables {
  budget_alert_email = "alerts@example.com"
  backend_image      = "ghcr.io/sour-dev-home/satisfactory-dash-backend@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  ops_image          = "ghcr.io/sour-dev-home/satisfactory-dash-ops@sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"
  backup_b2          = { bucket = "example-bucket", endpoint = "https://s3.example-region.backblazeb2.com", region = "example-region" }
}

run "criterion_1_four_ops_tasks_run_their_npm_scripts_on_the_ops_image" {
  command = apply

  assert {
    condition     = toset(keys(aws_ecs_task_definition.ops)) == toset(["db-init", "db-migrate", "backup", "restore"])
    error_message = "one task definition each for db:init, db:migrate, backup and the restore"
  }

  assert {
    condition = alltrue([for k, td in aws_ecs_task_definition.ops :
      length(jsondecode(td.container_definitions)) == 1 && jsondecode(td.container_definitions)[0].image == var.ops_image
    ])
    error_message = "each task runs one container, the ops image by digest"
  }

  assert {
    condition = alltrue([for k, td in aws_ecs_task_definition.ops :
      one(td.runtime_platform).cpu_architecture == "ARM64" && td.requires_compatibilities == toset(["FARGATE"]) && td.network_mode == "awsvpc"
    ])
    error_message = "Fargate ARM64 in awsvpc mode, like the service"
  }

  assert {
    condition     = strcontains(join(" ", jsondecode(aws_ecs_task_definition.ops["db-init"].container_definitions)[0].command), "npm run --silent db:init -w backend")
    error_message = "the db-init task runs npm run db:init"
  }

  assert {
    condition     = jsondecode(aws_ecs_task_definition.ops["db-migrate"].container_definitions)[0].command == ["npm", "run", "--silent", "db:migrate", "-w", "backend"]
    error_message = "the db-migrate task runs npm run db:migrate"
  }

  assert {
    condition     = jsondecode(aws_ecs_task_definition.ops["backup"].container_definitions)[0].command == ["npm", "run", "--silent", "backup", "-w", "backend"]
    error_message = "the backup task runs npm run backup, the same command as compose.yaml"
  }

  assert {
    condition     = strcontains(join(" ", jsondecode(aws_ecs_task_definition.ops["restore"].container_definitions)[0].command), "pg_restore")
    error_message = "the restore task runs pg_restore"
  }

  assert {
    condition = alltrue([for k, td in aws_ecs_task_definition.ops :
      td.execution_role_arn == aws_iam_role.ops_execution[k].arn && td.task_role_arn == null
    ])
    error_message = "each ops task has its own execution role and no task role (no AWS credentials in the container)"
  }
}

run "criterion_1_only_db_init_reads_the_rds_master_secret" {
  command = apply

  assert {
    condition = alltrue([for k, p in aws_iam_role_policy.ops_execution :
      strcontains(p.policy, "secretsmanager:") == (k == "db-init")
    ])
    error_message = "only the db-init execution role has any Secrets Manager permission"
  }

  assert {
    condition = alltrue([for s in jsondecode(aws_iam_role_policy.ops_execution["db-init"].policy).Statement :
      s.Resource == [aws_db_instance.main.master_user_secret[0].secret_arn] if contains(flatten([s.Action]), "secretsmanager:GetSecretValue")
    ])
    error_message = "db-init reads exactly the RDS master secret"
  }

  assert {
    condition = alltrue([for k, td in aws_ecs_task_definition.ops :
      anytrue([for s in jsondecode(td.container_definitions)[0].secrets : strcontains(s.valueFrom, ":secretsmanager:")]) == (k == "db-init")
    ])
    error_message = "only the db-init container injects a Secrets Manager value"
  }

  assert {
    condition     = contains([for s in jsondecode(aws_ecs_task_definition.ops["db-init"].container_definitions)[0].secrets : s.valueFrom if s.name == "DB_MASTER_PASSWORD"], "${aws_db_instance.main.master_user_secret[0].secret_arn}:password::")
    error_message = "db-init takes only the password key of the master secret"
  }

  assert {
    condition     = toset([for s in jsondecode(aws_ecs_task_definition.ops["db-migrate"].container_definitions)[0].secrets : s.name]) == toset(["MIGRATOR_DATABASE_URL"])
    error_message = "the migrate task gets only the migrator's URL"
  }

  assert {
    condition = alltrue([for k, p in aws_iam_role_policy.ops_execution :
      toset(flatten([for s in jsondecode(p.policy).Statement : s.Resource if contains(flatten([s.Action]), "ssm:GetParameters")])) ==
      toset([for s in jsondecode(aws_ecs_task_definition.ops[k].container_definitions)[0].secrets : s.valueFrom if strcontains(s.valueFrom, ":ssm:")])
    ])
    error_message = "each execution role reads exactly the SSM parameters its own task injects"
  }

  assert {
    condition = alltrue([for k, r in aws_iam_role.ops_execution :
      jsondecode(r.assume_role_policy).Statement[0].Principal.Service == "ecs-tasks.amazonaws.com" &&
      jsondecode(r.assume_role_policy).Statement[0].Condition.StringEquals["aws:SourceAccount"] != null
    ])
    error_message = "only ECS tasks in this account assume the ops execution roles"
  }
}

run "criterion_2_the_age_key_is_injected_from_a_transient_parameter_never_a_permanent_one" {
  command = apply

  assert {
    condition     = length([for s in jsondecode(aws_ecs_task_definition.ops["restore"].container_definitions)[0].secrets : s if s.name == "AGE_IDENTITY" && strcontains(s.valueFrom, ":parameter/satis/restore/")]) == 1
    error_message = "the restore reads the age key from /satis/restore/, the per-run path"
  }

  assert {
    condition     = !anytrue([for n in values(local.ssm_parameter_names) : startswith(n, "/satis/restore/")]) && !anytrue([for n in values(local.ssm_parameter_names) : strcontains(n, "AGE_IDENTITY")])
    error_message = "the age key is not one of the permanent /satis/prod/ parameters"
  }

  assert {
    condition = alltrue([for k, td in aws_ecs_task_definition.ops :
      !anytrue([for s in jsondecode(td.container_definitions)[0].secrets : strcontains(s.valueFrom, "/satis/restore/")]) if k != "restore"
    ])
    error_message = "no task but the restore injects a /satis/restore/ value"
  }

  assert {
    condition = alltrue([for k, p in aws_iam_role_policy.ops_execution :
      !strcontains(p.policy, "/satis/restore/") if k != "restore"
    ])
    error_message = "no role but the restore's can read /satis/restore/"
  }

  assert {
    condition     = !strcontains(aws_iam_role_policy.ops_execution["restore"].policy, "satis/restore/*") && !strcontains(aws_iam_role_policy.ops_execution["restore"].policy, "ssm:PutParameter")
    error_message = "the restore role reads its named parameters only, and can never write one"
  }

  assert {
    condition = alltrue([for s in jsondecode(aws_ecs_task_definition.ops["restore"].container_definitions)[0].secrets :
      !contains(["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"], s.name) || strcontains(s.valueFrom, ":parameter/satis/restore/B2_READ_")
    ])
    error_message = "the restore downloads with the per-run B2 read key, never the upload key"
  }
}

run "criterion_3_eventbridge_runs_the_backup_task_nightly" {
  command = apply

  assert {
    condition     = aws_scheduler_schedule.backup.schedule_expression == "cron(0 9 * * ? *)" && aws_scheduler_schedule.backup.schedule_expression_timezone == "UTC"
    error_message = "once a day, after the RDS backup and maintenance windows"
  }

  assert {
    condition     = aws_scheduler_schedule.backup.state == "ENABLED" && one(aws_scheduler_schedule.backup.flexible_time_window).mode == "OFF"
    error_message = "the schedule is on and fires at its time"
  }

  assert {
    condition     = one(aws_scheduler_schedule.backup.target).arn == aws_ecs_cluster.main.arn && one(one(aws_scheduler_schedule.backup.target).ecs_parameters).task_definition_arn == aws_ecs_task_definition.ops["backup"].arn
    error_message = "the target is the backup task in the cluster"
  }

  assert {
    condition     = one(one(one(aws_scheduler_schedule.backup.target).ecs_parameters).network_configuration).assign_public_ip == true && one(one(aws_scheduler_schedule.backup.target).ecs_parameters).launch_type == "FARGATE"
    error_message = "Fargate with a public IP for egress, as the service (no NAT gateway)"
  }

  assert {
    condition     = toset(one(one(one(aws_scheduler_schedule.backup.target).ecs_parameters).network_configuration).security_groups) == toset([aws_security_group.task.id])
    error_message = "the task group, the one RDS lets in"
  }

  assert {
    condition     = one(aws_scheduler_schedule.backup.target).role_arn == aws_iam_role.backup_scheduler.arn
    error_message = "the schedule uses its own role"
  }

  assert {
    condition = alltrue([for s in jsondecode(aws_iam_role_policy.backup_scheduler.policy).Statement :
      (s.Action == "ecs:RunTask" && s.Resource == ["${aws_ecs_task_definition.ops["backup"].arn_without_revision}:*"]) ||
      (s.Action == "iam:PassRole" && s.Resource == [aws_iam_role.ops_execution["backup"].arn])
    ])
    error_message = "the scheduler role runs only the backup task and passes only its execution role"
  }

  assert {
    condition     = jsondecode(aws_iam_role.backup_scheduler.assume_role_policy).Statement[0].Principal.Service == "scheduler.amazonaws.com"
    error_message = "EventBridge Scheduler assumes the scheduler role"
  }
}

run "backup_task_uploads_to_b2_with_the_upload_key" {
  command = apply

  assert {
    condition = toset([for e in jsondecode(aws_ecs_task_definition.ops["backup"].container_definitions)[0].environment : e.name]) == toset(
      ["AWS_DEFAULT_REGION", "BACKUP_LOCAL_DIR", "BACKUP_S3_BUCKET", "BACKUP_S3_ENDPOINT"]
    )
    error_message = "the backup's plain settings: the B2 bucket, endpoint and region, and the image's local dir"
  }

  assert {
    condition = toset([for s in jsondecode(aws_ecs_task_definition.ops["backup"].container_definitions)[0].secrets : s.name]) == toset(
      ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "BACKUP_AGE_RECIPIENT", "BACKUP_DATABASE_URL"]
    )
    error_message = "the backup's secrets, with no heartbeat until backup_heartbeat_enabled is set"
  }

  assert {
    condition     = contains([for s in jsondecode(aws_ecs_task_definition.ops["backup"].container_definitions)[0].secrets : s.valueFrom if s.name == "AWS_ACCESS_KEY_ID"], local.ssm_parameter_arns["B2_ACCESS_KEY_ID"])
    error_message = "the AWS CLI's key is the B2 upload key from SSM, never an AWS key"
  }

  assert {
    condition     = aws_cloudwatch_log_group.ops.retention_in_days == 14
    error_message = "the ops log group keeps 14 days"
  }
}

run "backup_heartbeat_is_injected_when_enabled" {
  command = apply

  variables {
    backup_heartbeat_enabled = true
  }

  assert {
    condition     = contains([for s in jsondecode(aws_ecs_task_definition.ops["backup"].container_definitions)[0].secrets : s.name], "BACKUP_HEARTBEAT_URL")
    error_message = "the heartbeat URL comes from SSM when enabled"
  }
}

run "ops_image_must_be_a_digest" {
  command = plan

  variables {
    ops_image = "ghcr.io/sour-dev-home/satisfactory-dash-ops:main"
  }

  expect_failures = [var.ops_image]
}

run "b2_endpoint_must_be_https_without_credentials" {
  command = plan

  variables {
    backup_b2 = { bucket = "example-bucket", endpoint = "https://user:pass@s3.example.com", region = "example-region" }
  }

  expect_failures = [var.backup_b2]
}

run "backup_schedule_must_be_cron_or_rate" {
  command = plan

  variables {
    backup_schedule = "every night"
  }

  expect_failures = [var.backup_schedule]
}
