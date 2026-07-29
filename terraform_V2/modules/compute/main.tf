data "aws_ami" "ubuntu" {
    filter {
        name = "name"
        values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
    }
    tags = {}
    owners = ["099720109477"] # Canonical
    most_recent = true
}
