output "romain_webserver_public_ip_address" {
  description = "Adresse IP publique de l'instance EC2 créée"
  value       = aws_instance.romain_webserver.public_ip
}
