provider "aws" {
  region = var.region

  default_tags {
    tags = local.etiquettes_communes
  }
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
    description = "HTTP sortant (mises a jour, depots apt)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "HTTPS sortant (mises a jour, depots apt)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.prefixe}-sg-web" }
}

# -------------------------------------------------------------- Instance -----
resource "aws_instance" "web" {
  ami                    = var.default_ubuntu_ami
  instance_type          = var.instance_type
  subnet_id              = var.default_public_subnet_id
  vpc_security_group_ids = [aws_security_group.web.id]
  key_name               = var.nom_cle_ssh

  # ---- Durcissement obligatoire (cf. Capital One 2019) --------------------
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
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
