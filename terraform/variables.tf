variable "aws_default_region" {
  type        = string
  description = "My AWS Default Region"
}

variable "default_ubuntu_ami" {
  type        = string
  description = "Default Ubuntu AMI"
}

variable "default_vpc_id" {
  type        = string
  description = "ID du VPC par défaut"
}

variable "default_public_subnet_id" {
  type        = string
  description = "ID du sous-réseau public par défaut"
}

variable "default_instance_type" {
  type        = string
  description = "Type d'instance EC2"
}

variable "default_sg_id" {
  default     = "sg-00000000000000000"
  type        = string
  description = "ID du Security Group"
}

variable "ssh_public_key_path" {
  default     = "~/.ssh/ansible-key.pub"
  type        = string
  description = "Chemin vers la clé publique SSH utilisée pour la key pair EC2"
}
