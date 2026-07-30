output "romain_webserver_public_ip_address" {
  description = "Adresse IP publique du serveur web déployé."
  value       = aws_instance.web.public_ip
}

output "id_instance" {
  description = "Identifiant de l'instance EC2."
  value       = aws_instance.web.id
}
