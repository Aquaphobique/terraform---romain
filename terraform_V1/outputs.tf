output "romain_webserver_public_ip_address" {
  description = "Adresse IP publique du serveur web déployé."
  value       = aws_instance.web.public_ip
}

output "id_instance" {
  description = "Identifiant de l'instance EC2."
  value       = aws_instance.web.id
}

output "security_group_id" {
  description = "ID du security group de l'instance web — utilisé par le pipeline CI pour autoriser/révoquer temporairement l'IP du runner en SSH."
  value       = aws_security_group.web.id
}
