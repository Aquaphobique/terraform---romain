locals {
  prefixe = "${var.proprietaire}-tp2"

  etiquettes_communes = {
    Projet      = var.projet
    Environment = var.environnement
    ManagedBy   = "terraform"
    Owner       = var.proprietaire
  }

  # Premier sous-réseau /24 découpé dans le CIDR du VPC (ex: 10.20.0.0/16 -> 10.20.0.0/24)
  cidr_subnet_public = cidrsubnet(var.cidr_vpc, 8, 0)
}
