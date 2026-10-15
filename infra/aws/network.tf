# ADR-0034 §2: public subnets only, no NAT gateway, no load balancer. The task reaches out (the
# Cloudflare tunnel, ECR, SSM) through the internet gateway with a public IP, and nothing reaches in.

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "satis-${local.environment}" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = { Name = "satis-${local.environment}" }
}

resource "aws_subnet" "public" {
  count = length(var.availability_zones)

  vpc_id            = aws_vpc.main.id
  availability_zone = var.availability_zones[count.index]
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 1)

  # The ECS service asks for a public IP per task (assign_public_ip); nothing else gets one by default,
  # so the database never has a public address.
  map_public_ip_on_launch = false

  tags = { Name = "satis-${local.environment}-public-${var.availability_zones[count.index]}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "satis-${local.environment}-public" }
}

resource "aws_route_table_association" "public" {
  count = length(aws_subnet.public)

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# Take over the VPC's default group and empty it, so a resource created without a group gets no access.
resource "aws_default_security_group" "main" {
  vpc_id = aws_vpc.main.id

  ingress = []
  egress  = []

  tags = { Name = "satis-${local.environment}-default-unused" }
}

# The backend + cloudflared task (ECS comes in a later issue). Outbound only: `ingress = []` also
# removes any inbound rule added outside Terraform on the next apply.
resource "aws_security_group" "task" {
  name        = "satis-${local.environment}-task"
  description = "ECS task: outbound only, no inbound rules"
  vpc_id      = aws_vpc.main.id

  ingress = []

  egress {
    description      = "Outbound to the tunnel, ECR, SSM, CloudWatch Logs and RDS"
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = []
    prefix_list_ids  = []
    security_groups  = []
    self             = false
  }

  tags = { Name = "satis-${local.environment}-task" }
}

# PostgreSQL, reachable from the task group only.
resource "aws_security_group" "rds" {
  name        = "satis-${local.environment}-rds"
  description = "RDS PostgreSQL: 5432 from the task group only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description      = "PostgreSQL from the ECS task"
    from_port        = 5432
    to_port          = 5432
    protocol         = "tcp"
    security_groups  = [aws_security_group.task.id]
    cidr_blocks      = []
    ipv6_cidr_blocks = []
    prefix_list_ids  = []
    self             = false
  }

  egress = []

  tags = { Name = "satis-${local.environment}-rds" }
}
