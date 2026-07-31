locals {
  prefixe = "${var.proprietaire}-tp2"

  etiquettes_communes = {
    Projet      = var.projet
    Environment = var.environnement
    ManagedBy   = "terraform"
    Owner       = var.proprietaire
  }

}
