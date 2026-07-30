#!/usr/bin/env python3
"""
Lit config/project.toml et affiche des `export TF_VAR_...` à charger dans le
shell avant terraform plan/apply. Ne gère QUE les paramètres publics du
projet — jamais de secrets (ceux-ci restent dans scripts/set-env.sh, ou dans
des secrets CI, jamais dans project.toml).

Usage :
    eval "$(python3 scripts/load-config.py)"

Nécessite Python >= 3.11 (module tomllib intégré). Sur une version plus
ancienne : pip install tomli --break-system-packages
"""
from pathlib import Path

try:
    import tomllib  # Python >= 3.11, module standard
except ModuleNotFoundError:
    import tomli as tomllib  # pip install tomli


def main() -> None:
    chemin = Path(__file__).resolve().parent.parent / "config" / "project.toml"

    with open(chemin, "rb") as f:
        config = tomllib.load(f)

    projet = config["project"]
    aws = config["aws"]

    variables = {
        "projet": projet["nom"],
        "proprietaire": projet["proprietaire"],
        "region": aws["region"],
        "cidr_vpc": aws["cidr_vpc"],
        "instance_type": aws["instance_type"],
    }

    for cle, valeur in variables.items():
        print(f'export TF_VAR_{cle}="{valeur}"')


if __name__ == "__main__":
    main()
