# Benchmark: Long Running EKS Cluster
# Purpose: Test performance with long-running resource provisioning (10+ minutes)

terraform {
  cloud {
    hostname = "otaco.app"
    organization = "org_01K8RTMAHF3QTTX62SSE0757AM"    
    workspaces {
      name = "benchmark-04-long-running-eks"
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

variable "cluster_name" {
  description = "Name of the EKS cluster"
  type        = string
  default     = "opentaco-benchmark-eks"
}

# VPC for EKS
resource "aws_vpc" "eks_benchmark" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name                                           = "${var.cluster_name}-vpc"
    "kubernetes.io/cluster/${var.cluster_name}"    = "shared"
    Benchmark                                      = "long-running-eks"
  }
}

# Subnets in different AZs
resource "aws_subnet" "eks_benchmark" {
  count = 2

  vpc_id                  = aws_vpc.eks_benchmark.id
  cidr_block              = "10.0.${count.index}.0/24"
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name                                           = "${var.cluster_name}-subnet-${count.index}"
    "kubernetes.io/cluster/${var.cluster_name}"    = "shared"
    Benchmark                                      = "long-running-eks"
  }
}

# Internet Gateway
resource "aws_internet_gateway" "eks_benchmark" {
  vpc_id = aws_vpc.eks_benchmark.id

  tags = {
    Name      = "${var.cluster_name}-igw"
    Benchmark = "long-running-eks"
  }
}

# Route table
resource "aws_route_table" "eks_benchmark" {
  vpc_id = aws_vpc.eks_benchmark.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.eks_benchmark.id
  }

  tags = {
    Name      = "${var.cluster_name}-rt"
    Benchmark = "long-running-eks"
  }
}

# Route table associations
resource "aws_route_table_association" "eks_benchmark" {
  count = 2

  subnet_id      = aws_subnet.eks_benchmark[count.index].id
  route_table_id = aws_route_table.eks_benchmark.id
}

# Data source for availability zones
data "aws_availability_zones" "available" {
  state = "available"
}

# IAM role for EKS cluster
resource "aws_iam_role" "eks_cluster" {
  name = "${var.cluster_name}-cluster-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "eks.amazonaws.com"
      }
    }]
  })

  tags = {
    Benchmark = "long-running-eks"
  }
}

resource "aws_iam_role_policy_attachment" "eks_cluster_policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
  role       = aws_iam_role.eks_cluster.name
}

# IAM role for EKS node group
resource "aws_iam_role" "eks_nodes" {
  name = "${var.cluster_name}-node-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ec2.amazonaws.com"
      }
    }]
  })

  tags = {
    Benchmark = "long-running-eks"
  }
}

resource "aws_iam_role_policy_attachment" "eks_worker_node_policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
  role       = aws_iam_role.eks_nodes.name
}

resource "aws_iam_role_policy_attachment" "eks_cni_policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
  role       = aws_iam_role.eks_nodes.name
}

resource "aws_iam_role_policy_attachment" "eks_container_registry_policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
  role       = aws_iam_role.eks_nodes.name
}

# EKS Cluster
resource "aws_eks_cluster" "benchmark" {
  name     = var.cluster_name
  role_arn = aws_iam_role.eks_cluster.arn

  vpc_config {
    subnet_ids = aws_subnet.eks_benchmark[*].id
  }

  depends_on = [
    aws_iam_role_policy_attachment.eks_cluster_policy,
  ]

  tags = {
    Benchmark = "long-running-eks"
  }
}

# EKS Node Group
resource "aws_eks_node_group" "benchmark" {
  cluster_name    = aws_eks_cluster.benchmark.name
  node_group_name = "${var.cluster_name}-node-group"
  node_role_arn   = aws_iam_role.eks_nodes.arn
  subnet_ids      = aws_subnet.eks_benchmark[*].id

  scaling_config {
    desired_size = 2
    max_size     = 3
    min_size     = 1
  }

  instance_types = ["t3.medium"]

  depends_on = [
    aws_iam_role_policy_attachment.eks_worker_node_policy,
    aws_iam_role_policy_attachment.eks_cni_policy,
    aws_iam_role_policy_attachment.eks_container_registry_policy,
  ]

  tags = {
    Benchmark = "long-running-eks"
  }
}

output "cluster_endpoint" {
  description = "Endpoint for EKS cluster"
  value       = aws_eks_cluster.benchmark.endpoint
}

output "cluster_name" {
  description = "Name of the EKS cluster"
  value       = aws_eks_cluster.benchmark.name
}
