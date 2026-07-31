provider "aws" {
  region = var.region

  default_tags {
    tags = local.etiquettes_communes
  }
}

# ---------------------------------------------------------------- Réseau -----
resource "aws_vpc" "principal" {
  cidr_block           = var.cidr_vpc
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "${local.prefixe}-vpc" }
}

resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.principal.id

  tags = { Name = "${local.prefixe}-igw" }
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.principal.id
  cidr_block              = local.cidr_subnet_public
  availability_zone       = "${var.region}a"
  map_public_ip_on_launch = true

  tags = { Name = "${local.prefixe}-public-a" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.principal.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }

  tags = { Name = "${local.prefixe}-rt-public" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = var.default_public_subnet_id
  route_table_id = aws_route_table.public.id
}

# ------------------------------------------------------ Groupe de sécurité ---
resource "aws_security_group" "web" {
  name        = "${local.prefixe}-web"
  description = "HTTP public, SSH restreint a IP admin"
  vpc_id      = var.default_vpc_id

  ingress {
    description = "HTTP depuis Internet"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "SSH depuis IP admin uniquement"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.cidr_admin]
  }

  egress {
    description = "Sortie libre (mises a jour)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.prefixe}-sg-web" }
}

# -------------------------------------------------------------- Instance -----
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }
}

resource "aws_instance" "web" {
  ami                    = var.default_ubuntu_ami
  instance_type          = var.instance_type
  subnet_id              = var.default_public_subnet_id
  vpc_security_group_ids = [aws_security_group.web.id]
  key_name               = var.nom_cle_ssh

  # ---- Durcissement obligatoire (cf. Capital One 2019) --------------------
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required" # IMDSv2 imposé
    http_put_response_hop_limit = 2
  }

  root_block_device {
    encrypted   = true
    volume_type = "gp3"
    volume_size = 10
  }

  user_data = <<-EOT
    #!/bin/bash
    set -euo pipefail
    apt-get update
    apt-get install -y nginx
    echo "<h1>${local.prefixe} — deploye par Terraform</h1>" > /var/www/html/index.html
    systemctl enable --now nginx
  EOT

  tags = { Name = "${local.prefixe}-web" }
}
