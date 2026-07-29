#!/usr/bin/env bash
# Fonctions d'affichage colorées, communes à tous les scripts du projet.
# Fait pour être sourcé : ne contient pas de set -euo pipefail propre
# (le script appelant garde la main sur ses propres options).

source "$(dirname "${BASH_SOURCE[0]}")/../constants/colors.sh"

display_msg() {
  local msg="$1"
  local type="${2:-}"

  case "$type" in
    info)
      echo -e "${INFO_COLOR}${msg}${RESET_COLOR}"
      ;;
    warning)
      echo -e "${WARNING_COLOR}${msg}${RESET_COLOR}"
      ;;
    error)
      echo -e "${ERROR_COLOR}${msg}${RESET_COLOR}" >&2
      ;;
    success)
      echo -e "${SUCCESS_COLOR}${msg}${RESET_COLOR}"
      ;;
    *)
      echo -e "${msg}"
      ;;
  esac
}
