# terraform_v1 — gouvernance

Fichiers de gouvernance du dépôt : garde-fous locaux (pre-commit) et CI
(GitHub Actions), indépendants de toute configuration Terraform précise.

## Prérequis

- Un shell POSIX (WSL2 ou Git Bash sous Windows — jamais cmd.exe ou
  PowerShell pour lancer `make`)
- `pre-commit` et `gitleaks` (garde-fous, voir Gouvernance ci-dessous)

## Démarrage

```bash
make help
```

## Gouvernance

Ce dépôt utilise `pre-commit` pour bloquer localement les erreurs courantes
(fins de ligne, fichiers de fusion oubliés, secrets) avant qu'elles
n'atteignent le dépôt distant.

Installation :

```bash
pipx install pre-commit
pre-commit install
```

Lancer tous les hooks manuellement :

```bash
make lint
```

Scanner tout l'historique à la recherche de secrets (indépendant de
pre-commit, utile en audit ponctuel) :

```bash
make secrets
```

`pre-commit` s'exécute côté client et peut être contourné avec
`--no-verify` : ce n'est qu'un filet ergonomique. La vraie barrière est la
protection de la branche `master`, qui exige que ces mêmes vérifications
passent en CI avant toute fusion.

Un workflow GitHub Actions (`.github/workflows/pre-commit.yml`) rejoue
les mêmes hooks côté serveur à chaque push sur `dev` et sur cette
branche — impossible à contourner avec `--no-verify`.

## Rapport TP1

Voir [`docs/tp1-reponses.md`](docs/tp1-reponses.md) pour le compte-rendu
des exercices 2.1, 2.2 et du TP1 complet.
