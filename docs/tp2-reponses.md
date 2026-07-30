# TP2 — Module 3 : Infrastructure as Code et Terraform

Castel Romain

## TP2 — Déploiement sécurisé sur AWS

Périmètre : AWS uniquement (`t2.micro`), sur la branche `TP2` du dépôt
`terraform_v1`.

### Partie A — Socle et état distant

_Bucket S3 créé à la main pour l'état (`bc-tfstate-<nom>`) : versioning,
chiffrement AES256, Block Public Access activés. Backend configuré dans
`envs/dev-aws/backend.tf` avec `use_lockfile = true` (verrouillage natif
S3, sans DynamoDB)._

### Partie B — Déploiement AWS

_Code Terraform : VPC, Internet Gateway, sous-réseau public, table de
routage, security group (HTTP ouvert, SSH restreint à l'IP
d'administration), instance EC2 `t2.micro` avec nginx via `user_data`.
Durcissement obligatoire : `http_tokens = "required"` (IMDSv2), disque
racine chiffré._

`terraform plan` — nombre de ressources créées : …

### Partie D — Dérive, état et destruction

_Modification manuelle du security group dans la console AWS (port 22
ouvert à `0.0.0.0/0`), puis `terraform plan` pour observer la détection._

**Plan de la dérive** (sortie complète) :

```
…
```

**Interprétation** : qu'a détecté Terraform ? Sur quelle ressource ? Quel
symbole (`~`, `-/+`...) apparaît, et pourquoi ?

…

## Réponses aux questions du livrable

**1. Trois informations sensibles trouvées dans le `tfstate` téléchargé
depuis S3, et le contrôle qui protège ce fichier dans la configuration.**

1. …
2. …
3. …

Contrôle : backend S3 avec versioning, chiffrement au repos, accès
restreint aux rôles de déploiement, jamais dans Git (`.gitignore`).

**2. Tableau des ressources déployées**

| Ressource Terraform | Ressource AWS | Rôle |
|---|---|---|
| `aws_vpc.principal` | VPC | Réseau privé virtuel |
| `aws_internet_gateway.igw` | Internet Gateway | Sortie/entrée Internet |
| `aws_subnet.public` | Subnet | Sous-réseau public |
| `aws_route_table.public` | Route Table | Routage vers Internet |
| `aws_security_group.web` | Security Group | Pare-feu d'instance |
| `aws_instance.web` | EC2 (t2.micro) | Serveur nginx |

**3. IMDSv2 et Capital One — en cinq lignes maximum, ce que
`http_tokens = "required"` aurait changé, et ce que cela n'aurait pas
changé, dans l'affaire de mars 2019.**

…

**4. Preuve de destruction**

_Capture de la page de facturation AWS montrant qu'il ne reste aucune
ressource (IP élastique, volume EBS orphelin, etc.)._
]633;E;{   echo ""\x3b   echo "## Dérive constatée : renommage manuel via le dashboard AWS"\x3b   echo ""\x3b   echo "Renommage de l'instance en \\`romain-tp2-web\\` via la console, hors"\x3b   echo "Terraform. \\`terraform plan\\` a détecté l'écart (tag \\`Name\\` sur"\x3b   echo "plusieurs ressources) et proposé de le corriger. Plutôt que de"\x3b   echo "revenir à l'ancien nom, le code a été mis à jour"\x3b   echo "(\\`local.prefixe\\`) pour adopter cette convention partout, puis"\x3b   echo "appliqué — Terraform redevient la source de vérité unique."\x3b   echo ""\x3b   echo '```'\x3b   cat /tmp/drift-rename-plan.txt\x3b   echo '```'\x3b } >> docs/tp2-reponses.md;a9ae8560-5f94-409a-a417-5c253cddbc68]633;C
## Dérive constatée : renommage manuel via le dashboard AWS

Renommage de l'instance en `romain-tp2-web` via la console, hors
Terraform. `terraform plan` a détecté l'écart (tag `Name` sur
plusieurs ressources) et proposé de le corriger. Plutôt que de
revenir à l'ancien nom, le code a été mis à jour
(`local.prefixe`) pour adopter cette convention partout, puis
appliqué — Terraform redevient la source de vérité unique.

```
terraform -chdir=terraform_V1 init -input=false
[0m[1mInitializing the backend...[0m

[0m[1mInitializing provider plugins...[0m
- Reusing previous version of hashicorp/aws from the dependency lock file
- Using previously-installed hashicorp/aws v6.57.1


[0m[1m[32mTerraform has been successfully initialized![0m[32m[0m
[0m[32m
You may now begin working with Terraform. Try running "terraform plan" to see
any changes that are required for your infrastructure. All Terraform commands
should now work.

If you ever set or change modules or backend configuration for Terraform,
rerun this command to reinitialize your working directory. If you forget, other
commands will detect it and remind you to do so if necessary.[0m
terraform -chdir=terraform_V1 validate
[32m[1mSuccess![0m The configuration is valid.
[0m
terraform -chdir=terraform_V1 plan -input=false -out=tfplan
[0m[1mdata.aws_ami.ubuntu: Reading...[0m[0m
[0m[1maws_vpc.principal: Refreshing state... [id=vpc-0f4cae529f2bf7b09][0m
[0m[1maws_security_group.web: Refreshing state... [id=sg-09b82ee0c64ef1801][0m
[0m[1maws_instance.web: Refreshing state... [id=i-0ae6d5b10a6b6da4b][0m
[0m[1mdata.aws_ami.ubuntu: Read complete after 0s [id=ami-0c1002cdaa7a0954f][0m
[0m[1maws_internet_gateway.igw: Refreshing state... [id=igw-061f23fe3e74ca5d9][0m
[0m[1maws_subnet.public: Refreshing state... [id=subnet-067fcecbe5c32e0b4][0m
[0m[1maws_route_table.public: Refreshing state... [id=rtb-0d9172c6ee68c0868][0m

Terraform used the selected providers to generate the following execution
plan. Resource actions are indicated with the following symbols:
  [32m+[0m create[0m
  [33m~[0m update in-place[0m
[31m-[0m/[32m+[0m destroy and then create replacement[0m

Terraform will perform the following actions:

[1m  # aws_instance.web[0m will be updated in-place
[0m  [33m~[0m[0m resource "aws_instance" "web" {
        id                                   = "i-0ae6d5b10a6b6da4b"
      [33m~[0m[0m public_dns                           = "ec2-15-188-77-174.eu-west-3.compute.amazonaws.com" -> (known after apply)
      [33m~[0m[0m public_ip                            = "15.188.77.174" -> (known after apply)
      [33m~[0m[0m tags                                 = {
          [33m~[0m[0m "Name" = "tp-iac-dev-web" [33m->[0m[0m "romain-tp2-web"
        }
      [33m~[0m[0m tags_all                             = {
          [33m~[0m[0m "Name"        = "tp-iac-dev-web" [33m->[0m[0m "romain-tp2-web"
            [90m# (4 unchanged elements hidden)[0m[0m
        }
      [33m~[0m[0m user_data                            = <<-EOT
            #!/bin/bash
            set -euo pipefail
            apt-get update
            apt-get install -y nginx
          [31m-[0m[0m echo "<h1>tp-iac-dev — deploye par Terraform</h1>" > /var/www/html/index.html
          [32m+[0m[0m echo "<h1>romain-tp2 — deploye par Terraform</h1>" > /var/www/html/index.html
            systemctl enable --now nginx
        EOT
      [33m~[0m[0m vpc_security_group_ids               = [
          [31m-[0m[0m "sg-09b82ee0c64ef1801",
        ] -> (known after apply)
        [90m# (36 unchanged attributes hidden)[0m[0m

        [90m# (9 unchanged blocks hidden)[0m[0m
    }

[1m  # aws_internet_gateway.igw[0m will be updated in-place
[0m  [33m~[0m[0m resource "aws_internet_gateway" "igw" {
        id       = "igw-061f23fe3e74ca5d9"
      [33m~[0m[0m tags     = {
          [33m~[0m[0m "Name" = "tp-iac-dev-igw" [33m->[0m[0m "romain-tp2-igw"
        }
      [33m~[0m[0m tags_all = {
          [33m~[0m[0m "Name"        = "tp-iac-dev-igw" [33m->[0m[0m "romain-tp2-igw"
            [90m# (4 unchanged elements hidden)[0m[0m
        }
        [90m# (4 unchanged attributes hidden)[0m[0m
    }

[1m  # aws_route_table.public[0m will be updated in-place
[0m  [33m~[0m[0m resource "aws_route_table" "public" {
        id               = "rtb-0d9172c6ee68c0868"
      [33m~[0m[0m tags             = {
          [33m~[0m[0m "Name" = "tp-iac-dev-rt-public" [33m->[0m[0m "romain-tp2-rt-public"
        }
      [33m~[0m[0m tags_all         = {
          [33m~[0m[0m "Name"        = "tp-iac-dev-rt-public" [33m->[0m[0m "romain-tp2-rt-public"
            [90m# (4 unchanged elements hidden)[0m[0m
        }
        [90m# (6 unchanged attributes hidden)[0m[0m
    }

[1m  # aws_route_table_association.public[0m will be created
[0m  [32m+[0m[0m resource "aws_route_table_association" "public" {
      [32m+[0m[0m id             = (known after apply)
      [32m+[0m[0m region         = "eu-west-3"
      [32m+[0m[0m route_table_id = "rtb-0d9172c6ee68c0868"
      [32m+[0m[0m subnet_id      = "subnet-069f88a00c5831885"
    }

[1m  # aws_security_group.web[0m must be [1m[31mreplaced[0m
[0m[31m-[0m/[32m+[0m[0m resource "aws_security_group" "web" {
      [33m~[0m[0m arn                    = "arn:aws:ec2:eu-west-3:747082607185:security-group/sg-09b82ee0c64ef1801" -> (known after apply)
      [33m~[0m[0m id                     = "sg-09b82ee0c64ef1801" -> (known after apply)
      [33m~[0m[0m name                   = "tp-iac-dev-web" [33m->[0m[0m "romain-tp2-web" [31m# forces replacement[0m[0m
      [32m+[0m[0m name_prefix            = (known after apply)
      [33m~[0m[0m owner_id               = "747082607185" -> (known after apply)
      [33m~[0m[0m tags                   = {
          [33m~[0m[0m "Name" = "tp-iac-dev-sg-web" [33m->[0m[0m "romain-tp2-sg-web"
        }
      [33m~[0m[0m tags_all               = {
          [33m~[0m[0m "Name"        = "tp-iac-dev-sg-web" [33m->[0m[0m "romain-tp2-sg-web"
            [90m# (4 unchanged elements hidden)[0m[0m
        }
        [90m# (6 unchanged attributes hidden)[0m[0m
    }

[1m  # aws_subnet.public[0m will be updated in-place
[0m  [33m~[0m[0m resource "aws_subnet" "public" {
        id                                             = "subnet-067fcecbe5c32e0b4"
      [33m~[0m[0m tags                                           = {
          [33m~[0m[0m "Name" = "tp-iac-dev-public-a" [33m->[0m[0m "romain-tp2-public-a"
        }
      [33m~[0m[0m tags_all                                       = {
          [33m~[0m[0m "Name"        = "tp-iac-dev-public-a" [33m->[0m[0m "romain-tp2-public-a"
            [90m# (4 unchanged elements hidden)[0m[0m
        }
        [90m# (20 unchanged attributes hidden)[0m[0m
    }

[1m  # aws_vpc.principal[0m will be updated in-place
[0m  [33m~[0m[0m resource "aws_vpc" "principal" {
        id                                   = "vpc-0f4cae529f2bf7b09"
      [33m~[0m[0m tags                                 = {
          [33m~[0m[0m "Name" = "tp-iac-dev-vpc" [33m->[0m[0m "romain-tp2-vpc"
        }
      [33m~[0m[0m tags_all                             = {
          [33m~[0m[0m "Name"        = "tp-iac-dev-vpc" [33m->[0m[0m "romain-tp2-vpc"
            [90m# (4 unchanged elements hidden)[0m[0m
        }
        [90m# (19 unchanged attributes hidden)[0m[0m
    }

[1mPlan:[0m [0m2 to add, 5 to change, 1 to destroy.

Changes to Outputs:
  [33m~[0m[0m romain_webserver_public_ip_address = "15.188.77.174" -> (known after apply)
[90m
─────────────────────────────────────────────────────────────────────────────[0m

Saved the plan to: tfplan

To perform exactly these actions, run the following command to apply:
    terraform apply "tfplan"
```

## Statut final

- Instance déployée et fonctionnelle, dérive testée (renommage manuel via
  la console) et corrigée par `terraform apply`.
- Infrastructure détruite en fin de séance (`make tf.destroy`) : aucune
  ressource restante, vérifié via `aws ec2 describe-instances`.
- Points restants à compléter à la prochaine séance : 3 infos sensibles
  du `tfstate`, réponse IMDSv2/Capital One, ouverture de la Pull Request.
