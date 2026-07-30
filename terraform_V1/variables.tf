variable "projet" {
  description = "Nom du projet, utilisé comme préfixe des ressources."
  type        = string
}

variable "environnement" {
  description = "Nom de l'environnement (dev, staging, prod)."
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environnement)
    error_message = "environnement doit valoir dev, staging ou prod."
  }
}

variable "proprietaire" {
  description = "Propriétaire de la ressource (tag Owner)."
  type        = string
}

variable "region" {
  description = "Région AWS cible."
  type        = string
  default     = "eu-west-3"
}

variable "cidr_vpc" {
  description = "Bloc CIDR du VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "instance_type" {
  description = "Type d'instance EC2."
  type        = string
  default     = "t2.micro"
}

variable "cidr_admin" {
  description = "IP publique de l'administrateur autorisée en SSH (format CIDR /32). Fournie via TF_VAR_cidr_admin, jamais en dur."
  type        = string
}

variable "nom_cle_ssh" {
  description = "Nom de la paire de clés EC2 existante (créée au préalable dans la console)."
  type        = string
}

variable "default_vpc_id" {
  description = "VPC par défaut fournie par l'école (imposée par la policy IAM)."
  type        = string
}

variable "default_public_subnet_id" {
  description = "Sous-réseau public par défaut fourni par l'école."
  type        = string
}

variable "default_ubuntu_ami" {
  description = "AMI Ubuntu whitelistée par la policy IAM du compte."
  type        = string
}

variable "default_sg_id" {
  description = "Security group par défaut (même VPC que le sous-réseau ci-dessus)."
  type        = string
}
