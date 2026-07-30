# TP2 — Module 3 : Infrastructure as Code et Terraform

Castel Romain

## TP2 — Déploiement sécurisé sur AWS

Périmètre : AWS uniquement (`t2.micro`), sur la branche `TP2` du dépôt
`terraform_v1`.

### Partie A — Socle et état distant

Bucket S3 créé à la main pour l'état (`bc-tfstate-romain-747082607185`) :
versioning, chiffrement AES256, Block Public Access activés. Backend
configuré dans `terraform_V1/backend.tf` avec `use_lockfile = true`
(verrouillage natif S3, sans DynamoDB).

### Partie B — Déploiement AWS

Code Terraform : VPC, Internet Gateway, sous-réseau public, table de
routage, security group (HTTP ouvert, SSH restreint à l'IP
d'administration), instance EC2 `t2.micro` avec nginx via `user_data`.
Durcissement obligatoire : `http_tokens = "required"` (IMDSv2), disque
racine chiffré.

**`terraform plan` — nombre de ressources créées : 7** (`aws_vpc.principal`,
`aws_internet_gateway.igw`, `aws_subnet.public`, `aws_route_table.public`,
`aws_route_table_association.public`, `aws_security_group.web`,
`aws_instance.web`).

**Incident rencontré et résolu** : le premier `terraform apply` de
l'instance a échoué avec un `explicit deny` IAM sur `ec2:RunInstances`
pour l'AMI/VPC utilisés — la policy du compte d'école restreint le
lancement d'instances au VPC par défaut fourni par AWS
(`vpc-0ebcdb39f7a526ef9`). Le code a été adapté (variables
`default_vpc_id` / `default_public_subnet_id`) pour déployer l'instance
et son security group dans ce VPC par défaut plutôt que dans le VPC créé
par Terraform. Illustration concrète du principe de moindre privilège vu
en cours : la policy IAM du compte, pas le code, définit la surface
réellement exploitable.

### Partie D — Dérive, état et destruction

Modification manuelle du nom de l'instance (`romain-tp2-web`) via la
console AWS, hors Terraform. `terraform plan` a détecté l'écart sur le
tag `Name` de plusieurs ressources et proposé de le corriger. Plutôt que
de revenir à l'ancien nom, le code (`local.prefixe`) a été mis à jour
pour adopter cette convention partout, puis appliqué — Terraform
redevient la source de vérité unique plutôt que la console.

**Plan de la dérive (sortie, nettoyée des codes couleur du terminal) :**

```
# aws_instance.web will be updated in-place
  ~ resource "aws_instance" "web" {
        id          = "i-0ae6d5b10a6b6da4b"
      ~ tags        = { ~ "Name" = "tp-iac-dev-web" -> "romain-tp2-web" }
      ~ tags_all    = { ~ "Name" = "tp-iac-dev-web" -> "romain-tp2-web" }
      ~ user_data   = <<-EOT
            ...
          - echo "<h1>tp-iac-dev — deploye par Terraform</h1>" > /var/www/html/index.html
          + echo "<h1>romain-tp2 — deploye par Terraform</h1>" > /var/www/html/index.html
            ...
        EOT
    }

# aws_internet_gateway.igw will be updated in-place
  ~ resource "aws_internet_gateway" "igw" {
      ~ tags     = { ~ "Name" = "tp-iac-dev-igw" -> "romain-tp2-igw" }
    }

# aws_route_table.public will be updated in-place
  ~ resource "aws_route_table" "public" {
      ~ tags = { ~ "Name" = "tp-iac-dev-rt-public" -> "romain-tp2-rt-public" }
    }

# aws_security_group.web must be replaced
-/+ resource "aws_security_group" "web" {
      ~ name = "tp-iac-dev-web" -> "romain-tp2-web" # forces replacement
      ~ tags = { ~ "Name" = "tp-iac-dev-sg-web" -> "romain-tp2-sg-web" }
    }

# aws_subnet.public will be updated in-place
  ~ resource "aws_subnet" "public" {
      ~ tags = { ~ "Name" = "tp-iac-dev-public-a" -> "romain-tp2-public-a" }
    }

# aws_vpc.principal will be updated in-place
  ~ resource "aws_vpc" "principal" {
      ~ tags = { ~ "Name" = "tp-iac-dev-vpc" -> "romain-tp2-vpc" }
    }

Plan: 2 to add, 5 to change, 1 to destroy.
```

**Interprétation** : Terraform détecte l'écart entre l'état enregistré
(`tfstate`, ancien nom) et le code (nouveau `local.prefixe`) sur
**six ressources**. Le symbole `~` (mise à jour en place) domine : un tag
`Name` se change sans recréer la ressource sous-jacente — l'instance
elle-même n'est jamais recréée, aucune interruption de service. Seul le
`security_group` est marqué `-/+` (`# forces replacement`) : chez AWS, le
`name` d'un security group ne peut pas être modifié à chaud, Terraform
doit donc le détruire puis en recréer un — d'où le `1 to destroy` global
malgré une intention purement cosmétique (renommage).

## Réponses aux questions du livrable

**1. Trois informations sensibles trouvées dans le `tfstate` téléchargé
depuis S3, et le contrôle qui protège ce fichier dans la configuration.**

1. L'adresse IP publique personnelle de l'administrateur
   (`37.70.218.118/32`), en clair dans la règle SSH du security group —
   identifie et localise l'auteur du déploiement.
2. Le nom de la paire de clés EC2 (`ma-cle-ec2`) associé à l'identifiant
   complet du compte AWS (`747082607185`) et à l'utilisateur IAM
   `romain` — cartographie exacte de qui a accès à quoi.
3. L'AMI utilisée, les identifiants de VPC/sous-réseau, et les
   métadonnées réseau complètes de l'instance (IP privée, DNS interne,
   ID d'instance) — un plan d'attaque prêt à l'emploi en cas de fuite,
   exactement l'avertissement du Module 3.

**Contrôle** : backend S3 avec versioning, chiffrement au repos (AES256),
Block Public Access activé, verrouillage natif (`use_lockfile`), accès
restreint au compte du déploiement, jamais commité dans Git (`.gitignore`
couvre `*.tfstate*`).

**2. Tableau des ressources déployées**

| Ressource Terraform | Ressource AWS | Rôle |
|---|---|---|
| `aws_vpc.principal` | VPC | Réseau privé virtuel |
| `aws_internet_gateway.igw` | Internet Gateway | Sortie/entrée Internet |
| `aws_subnet.public` | Subnet | Sous-réseau public |
| `aws_route_table.public` | Route Table | Routage vers Internet |
| `aws_security_group.web` | Security Group | Pare-feu d'instance |
| `aws_instance.web` | EC2 (t2.micro) | Serveur nginx |

**3. IMDSv2 et Capital One — en cinq lignes maximum.**

`http_tokens = "required"` aurait bloqué la primitive SSRF utilisée dans
l'affaire Capital One : une requête `GET` simple ne peut plus récupérer
les identifiants IAM temporaires sans d'abord forger un `PUT` avec un
en-tête personnalisé, ce qu'un SSRF basique ne sait pas faire. En
revanche, IMDSv2 n'aurait rien changé à la cause racine identifiée par
l'enquête : le rôle IAM attaché au WAF avait des permissions largement
excessives (accès à tous les buckets S3), en violation du principe de
moindre privilège — un attaquant capable de forger la requête `PUT`
(SSRF plus évolué) aurait toujours pu exfiltrer les données.

**4. Preuve de destruction**

*Statut à la date de rédaction* : l'instance de ce TP2
(`romain-tp2-web`, actuellement `35.180.210.122`) a été détruite une
première fois en fin de séance initiale (vérifié via
`aws ec2 describe-instances` : aucune ressource résiduelle), puis
**redéployée volontairement** pour servir de support à un exercice
Ansible du module suivant (déploiement d'un site statique). Capture de
facturation à joindre une fois cette VM définitivement détruite
(`make tf.destroy`) — ne pas rendre ce TP tant que cette étape n'est pas
faite et documentée ici.
