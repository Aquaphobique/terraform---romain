#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../utils/display.sh"

GIT_REMOTE_URL="git@github.com:Aquaphobique/terraform-v1.git"

if [ ! -d ".git" ]; then
  git init
  git add .
  git commit -m "feat/first-commit"
  git remote add origin "${GIT_REMOTE_URL}"
  git remote -v
  display_msg "Dépôt git initialisé et remote ajouté." success
else
  display_msg "Already a git repo" info

  if ! git remote get-url origin > /dev/null 2>&1; then
    git remote add origin "${GIT_REMOTE_URL}"
    display_msg "Remote 'origin' ajouté." success
  fi
fi
