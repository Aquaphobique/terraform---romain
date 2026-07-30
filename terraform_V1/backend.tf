terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Le bucket doit être créé À LA MAIN avant `terraform init` (Partie A du TP) :
  # versioning + Block Public Access + chiffrement activés.
  backend "s3" {
    bucket       = "bc-tfstate-romain-747082607185" # nom du bucket créé à la main
    key          = "terraform_V1/terraform.tfstate"
    region       = "eu-west-3"
    encrypt      = true
    use_lockfile = true # verrouillage natif S3 (Terraform >= 1.11), pas de DynamoDB
  }
}
