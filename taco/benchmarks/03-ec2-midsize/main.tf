# Benchmark: EC2 Midsize Instance
# Purpose: Test real-world cloud resource provisioning

terraform {
  cloud {
    hostname = "otaco.app"
    organization = "org_01K8RTMAHF3QTTX62SSE0757AM"    
    workspaces {
      name = "028448c3-cefd-42c2-872c-f8ce055b5554"
    }
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "us-east-1"
}

# VPC for the instance
resource "aws_vpc" "benchmark" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name      = "opentaco-benchmark-vpc"
    Benchmark = "ec2-midsize"
  }
}

# Subnet
resource "aws_subnet" "benchmark" {
  vpc_id                  = aws_vpc.benchmark.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = true

  tags = {
    Name      = "opentaco-benchmark-subnet"
    Benchmark = "ec2-midsize"
  }
}

# Internet Gateway
resource "aws_internet_gateway" "benchmark" {
  vpc_id = aws_vpc.benchmark.id

  tags = {
    Name      = "opentaco-benchmark-igw"
    Benchmark = "ec2-midsize"
  }
}

# Route table
resource "aws_route_table" "benchmark" {
  vpc_id = aws_vpc.benchmark.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.benchmark.id
  }

  tags = {
    Name      = "opentaco-benchmark-rt"
    Benchmark = "ec2-midsize"
  }
}

# Route table association
resource "aws_route_table_association" "benchmark" {
  subnet_id      = aws_subnet.benchmark.id
  route_table_id = aws_route_table.benchmark.id
}

# Security group
resource "aws_security_group" "benchmark" {
  name        = "opentaco-benchmark-sg"
  description = "Security group for benchmark EC2 instance"
  vpc_id      = aws_vpc.benchmark.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name      = "opentaco-benchmark-sg"
    Benchmark = "ec2-midsize"
  }
}

# Data source for AMI
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# Data source for availability zones
data "aws_availability_zones" "available" {
  state = "available"
}

# EC2 Instance (t3.medium)
resource "aws_instance" "benchmark" {
  ami           = data.aws_ami.ubuntu.id
  instance_type = "t3.medium"
  subnet_id     = aws_subnet.benchmark.id

  vpc_security_group_ids = [aws_security_group.benchmark.id]

  root_block_device {
    volume_type = "gp3"
    volume_size = 20
  }

  tags = {
    Name      = "opentaco-benchmark-instance"
    Benchmark = "ec2-midsize"
  }
}

output "instance_id" {
  description = "ID of the EC2 instance"
  value       = aws_instance.benchmark.id
}

output "instance_public_ip" {
  description = "Public IP of the EC2 instance"
  value       = aws_instance.benchmark.public_ip
}
