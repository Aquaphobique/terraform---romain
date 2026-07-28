# =============================================================================
# Makefile — projet Terraform + Ansible
# =============================================================================

# ---- Reproductibilité et durcissement ---------------------------------------
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help
MAKEFLAGS += --warn-undefined-variables --no-print-directory

# ---- Couleurs ANSI ------------------------------------------------------------
INFO_COLOR    := \033[36;1m
WARNING_COLOR := \033[33;1m
ERROR_COLOR   := \033[31;1m
SUCCESS_COLOR := \033[32;1m
RESET_COLOR   := \033[0m

# ---- Répertoires --------------------------------------------------------------
GIT_DIR      := scripts/git
ANSIBLE_DIR  := ansible
TF_DIR       := terraform

# Commande Terraform pointant toujours vers le bon répertoire de travail.
# (bug v1 : la variable s'appelait TF_CHG_dir, référencée ailleurs comme
# TF_CHG_DIR — Make la traitait donc comme vide et exécutait juste "terraform")
TF := terraform -chdir=$(TF_DIR)

.PHONY: help git ansible-version terraform-version \
        tf.init tf.fmt tf.validate tf.plan tf.apply tf.destroy tf.build tf.clean \
        ansible.play

# ---- Aide -----------------------------------------------------------------
help: ## Affiche cette aide
	@echo ""
	@echo "  Cibles disponibles :"
	@echo ""
	@grep -E "^[a-zA-Z0-9._-]+:.*?## .*$$" $(MAKEFILE_LIST) \
		| sort \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  $(INFO_COLOR)%-16s$(RESET_COLOR)%s\n", $$1, $$2}'
	@echo ""

# ---- Versions / diagnostics -------------------------------------------------
ansible-version: ## Affiche la version d'Ansible installée
	@ansible --version

terraform-version: ## Affiche la version de Terraform installée
	@terraform -v

# ---- Cycle Terraform ---------------------------------------------------------
tf.init: ## Initialise le répertoire de travail Terraform
	@$(TF) init -input=false

tf.fmt: ## Formate le code Terraform
	@$(TF) fmt -recursive
	@echo -e "$(SUCCESS_COLOR)Formatting done$(RESET_COLOR)"

tf.validate: tf.init ## Valide la syntaxe et la cohérence de la configuration
	@$(TF) validate

tf.plan: tf.validate ## Calcule le plan d'exécution Terraform
	@$(TF) plan -input=false -out=tfplan

tf.apply: ## Applique le plan précédemment calculé (make tf.plan d'abord)
	@$(TF) apply -input=false tfplan
	@echo -e "$(SUCCESS_COLOR)Instance created successfully$(RESET_COLOR)"
	@$(TF) output romain_webserver_public_ip_address

tf.destroy: ## Détruit l'infrastructure gérée par Terraform
	@$(TF) destroy

tf.build: tf.fmt tf.plan tf.apply ## Formate, planifie et applique en une seule commande

tf.clean: ## Nettoie les artefacts locaux Terraform (.terraform, plans)
	@rm -rf $(TF_DIR)/.terraform $(TF_DIR)/tfplan
	@echo -e "$(SUCCESS_COLOR)Cleaned$(RESET_COLOR)"

# ---- Git ----------------------------------------------------------------------
git: ## Initialise le dépôt git (idempotent)
	@./$(GIT_DIR)/main.sh

# ---- Ansible --------------------------------------------------------------
ansible.play: ## Joue le playbook Ansible local
	@ansible-playbook $(ANSIBLE_DIR)/localhost/playbook.yml
