# =============================================================================
# Makefile — projet Terraform + Ansible
# =============================================================================

# ---- Reproductibilité et durcissement ---------------------------------------
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help
MAKEFLAGS += --warn-undefined-variables --no-print-directory

# ---- Répertoires --------------------------------------------------------------
GIT_DIR      := scripts/git
ANSIBLE_DIR  := ansible
TF_DIR       := terraform_V1

TF := terraform -chdir=$(TF_DIR)

.PHONY: help git ansible-version terraform-version \
        tf.init tf.normalize tf.validate tf.plan tf.apply tf.destroy tf.build tf.pipe tf.clean \
        ansible.play lint secrets

# ---- Aide -----------------------------------------------------------------
help: ## Affiche cette aide
	@grep -E "^[a-zA-Z0-9._-]+:.*?## .*$$" $(MAKEFILE_LIST) \
		| sort \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  %-16s%s\n", $$1, $$2}'

# ---- Versions / diagnostics -------------------------------------------------
ansible-version: ## Affiche la version d'Ansible installée
	ansible --version

terraform-version: ## Affiche la version de Terraform installée
	terraform -v

# ---- Cycle Terraform ---------------------------------------------------------
# Pas de @ devant les commandes ci-dessous : Make affiche la commande ET son
# résultat, comme -v le ferait pour un outil qui n'a pas de mode verbeux dédié.

tf.init: ## Initialise le répertoire de travail Terraform
	$(TF) init -input=false

tf.normalize: ## Formate le code Terraform (liste les fichiers reformatés)
	$(TF) fmt -recursive -diff

tf.validate: tf.init ## Valide la syntaxe et la cohérence de la configuration
	$(TF) validate

tf.plan: tf.validate ## Calcule le plan d'exécution Terraform
	$(TF) plan -input=false -out=tfplan

tf.apply: ## Applique le plan précédemment calculé (make tf.plan d'abord)
	$(TF) apply -input=false tfplan
	$(TF) output romain_webserver_public_ip_address

tf.destroy: ## Détruit l'infrastructure gérée par Terraform
	$(TF) destroy

tf.build: tf.normalize tf.plan tf.apply ## Formate, planifie et applique en une seule commande

tf.pipe: tf.normalize ## Pipeline complet : validate, plan, scan sécurité
	$(TF) validate
	$(TF) plan -out=tfplan
	$(TF) show -json tfplan > $(TF_DIR)/tfplan.json
	trivy config $(TF_DIR)/tfplan.json

tf.clean: ## Nettoie les artefacts locaux Terraform (.terraform, plans)
	rm -rfv $(TF_DIR)/.terraform $(TF_DIR)/tfplan

# ---- Git ----------------------------------------------------------------------
git: ## Initialise le dépôt git (idempotent)
	@./$(GIT_DIR)/main.sh

# ---- Ansible --------------------------------------------------------------
ansible.play: ## Joue le playbook Ansible local (-v : sortie détaillée par tâche)
	ansible-playbook -v $(ANSIBLE_DIR)/localhost/playbook.yml

# ---- Gouvernance (TP1 — Module 2) --------------------------------------------
lint: ## Lance pre-commit sur tous les fichiers
	pre-commit run --all-files

secrets: ## Scanne tout l'historique à la recherche de secrets
	gitleaks detect --source . --verbose
