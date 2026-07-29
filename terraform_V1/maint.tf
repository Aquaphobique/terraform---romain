provider "aws" {
  region = var.aws_default_region
}

resource "aws_key_pair" "romain_keypair" {
  key_name   = "romain_keypair"
  public_key = file(var.ssh_public_key_path)
}

resource "aws_instance" "romain_webserver" {
  subnet_id     = var.default_public_subnet_id
  key_name      = aws_key_pair.romain_keypair.key_name
  ami           = var.default_ubuntu_ami
  instance_type = var.default_instance_type

  # Bug corrigé : on référence le Security Group (default_sg_id),
  # pas l'ID du VPC (default_vpc_id) comme dans la v1.
  vpc_security_group_ids = [var.default_sg_id]

  tags = {
    Name = "romain-webserver"
  }
}
