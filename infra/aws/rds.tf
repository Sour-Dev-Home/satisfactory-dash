# ADR-0034 §2: RDS PostgreSQL 18, db.t4g.micro, single-AZ, 20 GB gp3, private, 7-day backups.
# Plain PostgreSQL only (§3): no RDS-only extensions, so pg_dump/pg_restore moves the data off AWS.

resource "aws_db_subnet_group" "main" {
  name       = "satis-${local.environment}"
  subnet_ids = aws_subnet.public[*].id

  tags = { Name = "satis-${local.environment}" }
}

resource "aws_db_instance" "main" {
  identifier = "satis-${local.environment}"

  engine         = "postgres"
  engine_version = "18"
  instance_class = "db.t4g.micro"
  multi_az       = false

  allocated_storage     = 20
  max_allocated_storage = 0
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = var.db_name
  username = var.db_master_username
  # RDS generates the password and keeps it in Secrets Manager; Terraform never sees it.
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false

  backup_retention_period  = 7
  backup_window            = "07:00-07:30"
  maintenance_window       = "sun:08:00-sun:08:30"
  copy_tags_to_snapshot    = true
  delete_automated_backups = true

  auto_minor_version_upgrade  = true
  allow_major_version_upgrade = false

  performance_insights_enabled = false
  monitoring_interval          = 0

  deletion_protection       = var.db_deletion_protection
  skip_final_snapshot       = false
  final_snapshot_identifier = "satis-${local.environment}-final"
}
