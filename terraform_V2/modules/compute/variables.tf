variable "region" {
    type = string
    description = "Default Region"
}

variable "environment" {
    type = string
    description = "dev | staging | prod"
    validation {
      condition = contains(["dev","staging","prod"], var.environment)
      error_message = "Environment must be in dev, staging or prod"
    }

}

variable "project" {
    type = string
}
