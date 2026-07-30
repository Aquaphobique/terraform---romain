#!/usr/bin/env bash
# À UTILISER AVEC `source` :
#   source scripts/set-env.sh
#
# Pas de `set -e`/`set -u` ici : ce script est sourcé, donc son état de
# shell (y compris `set -e`) resterait actif dans le terminal interactif
# APRÈS son exécution si on l'activait — un des pièges classiques du
# `source`. On gère les erreurs explicitement à la place.

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

config_output="$(python3 "$script_dir/load-config.py" 2>&1)"
if [[ $? -ne 0 ]]; then
  echo "Erreur lors de la lecture de config/project.toml :" >&2
  echo "$config_output" >&2
  return 1 2>/dev/null || exit 1
fi
eval "$config_output"

ip_publique="$(curl -s --max-time 5 https://checkip.amazonaws.com)"
if [[ -z "$ip_publique" ]]; then
  echo "Impossible de récupérer votre IP publique (réseau ?)." >&2
  echo "Définissez-la manuellement : export TF_VAR_cidr_admin=\"VOTRE_IP/32\""
else
  export TF_VAR_cidr_admin="${ip_publique}/32"
  echo "TF_VAR_cidr_admin=$TF_VAR_cidr_admin"
fi

echo "Variables chargées (projet=$TF_VAR_projet, region=$TF_VAR_region)."
echo "N'oubliez pas : export TF_VAR_nom_cle_ssh=\"<votre-paire-de-cles-ec2>\""
