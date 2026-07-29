# terraform_v1

Infrastructure AWS (EC2 + key pair) pilotée par Terraform, avec un Makefile
comme interface unique entre poste local et CI/CD.

## Prérequis

- Terraform >= 1.2
- Un shell POSIX (WSL2 ou Git Bash sous Windows — jamais cmd.exe ou
  PowerShell pour lancer `make`)
- `trivy` (scan de sécurité IaC)
- `pre-commit` et `gitleaks` (garde-fous, voir Gouvernance ci-dessous)

## Démarrage

```bash
make help
```

## Structure

- `terraform_V1/` — configuration Terraform en cours d'utilisation (EC2 +
  key pair, structure à plat)
- `terraform_V2/` — nouvelle structure modulaire (`modules/`, `environments/`),
  en cours de construction
- `scripts/` — scripts bash partagés (init git, affichage, couleurs)
- `ansible/` — playbook local

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

---

## TP1 — Rapport

### Ce qui a été fait

**Partie A.** Ajout de `.gitattributes`, `.gitignore`, `.editorconfig`,
`README.md` et `Makefile` à la racine, sur cette branche, en commits
séparés par sujet.

**Partie B.** Ajout de `.pre-commit-config.yaml` (fins de ligne, fichiers de
fusion Git oubliés, clés privées, scan `gitleaks`) et des cibles `lint` /
`secrets` dans le Makefile. `pre-commit run --all-files` passé une première
fois pour valider la config avant de committer.

**Partie C.** Création d'un fichier `config/app.env` avec les identifiants
d'exemple officiels AWS (`AKIAIOSFODNN7EXAMPLE...`, invalides par
construction). Le commit normal est bloqué par `gitleaks`. Contourné avec
`--no-verify` pour prouver que ce n'est qu'un filet côté client. `make
secrets` détecte quand même le secret ensuite, car cette commande scanne
tout l'historique, pas seulement l'état courant. Historique purgé avec
`git filter-repo`, vérifié par une recherche qui ne renvoie plus rien.

**Partie D.** Signature SSH des commits configurée (clé `github-key`
déclarée sur GitHub en tant que *Signing Key*). Protection de la branche
`master` activée : pull request obligatoire, une approbation minimum, pas
de force push, pas de suppression. Testé : un push direct sur `master` est
bien rejeté.

### Réponses aux quatre questions

**1. Pourquoi `--no-verify` fonctionne-t-il, et quelle est la seule parade
réellement efficace ?**

`--no-verify` fonctionne parce que les hooks `pre-commit` tournent côté
client, en local, avant que le commit soit finalisé. Rien dans Git n'oblige
leur exécution — l'option est prévue nativement pour les désactiver
ponctuellement. Un dev pressé ou quelqu'un de malveillant avec un accès
local les contourne sans effort.

La seule parade qui tient : rejouer les mêmes vérifications côté serveur,
en CI, et rendre leur succès obligatoire via la protection de branche. Un
contrôle qui peut être contourné par un autre chemin n'est pas un contrôle.

**2. Le secret purgé était-il, à un moment, présent sur le serveur
distant ? Qu'aurait-il fallu faire en premier s'il avait été réel ?**

Oui — le commit contenant le fichier a été poussé (après le `--no-verify`)
avant la purge, donc il a bien transité par GitHub et y a résidé un
moment.

Si le secret avait été réel, la toute première chose à faire, avant même
de toucher à Git, aurait été de le révoquer chez AWS, d'en générer un
nouveau, et de vérifier les journaux d'usage pour voir si quelqu'un s'en
était déjà servi. La réécriture d'historique vient après : c'est du
nettoyage, pas de la remédiation. La laisser passer pour l'inverse est le
vrai risque — le secret peut avoir déjà été récupéré par un scanner
automatique en quelques minutes.

**3. En quoi la mutabilité des tags Git explique-t-elle l'incident
tj-actions/changed-files ?**

Un tag Git pointe vers un commit, mais rien n'empêche de le réécrire pour
qu'il pointe ailleurs, tout en gardant le même nom lisible. C'est
exactement ce qui s'est passé lors de cet incident : après compromission
du jeton d'accès du bot du projet, l'attaquant a réécrit l'ensemble des
tags de version pour qu'ils pointent tous vers un commit malveillant.

Tous les dépôts qui référençaient cette action par un tag lisible ont
récupéré le code malveillant au run suivant, sans qu'aucune ligne de leur
propre configuration n'ait changé. Seuls les dépôts ayant épinglé l'action
par empreinte de commit complète étaient protégés, parce qu'une empreinte
de contenu est une identité immuable — la réécrire changerait le hash
lui-même. Un nom lisible est un pointeur mutable, une empreinte de contenu
est une identité.

**4. Citez trois éléments du dépôt qui relèvent de la gestion de
configuration au sens ITIL du terme.**

- Le dépôt Git dans son ensemble, en tant que CMDB exécutable : il recense
  les éléments de configuration et leurs relations, sans jamais pouvoir
  diverger de la réalité puisqu'il est ce qui construit effectivement le
  système.
- Chaque commit sur la branche protégée constitue une ligne de base
  (baseline) : un état de référence approuvé et figé, identifié par une
  empreinte infalsifiable, vers lequel on peut revenir en cas de problème.
- Le fichier `.terraform.lock.hcl`, qui fige les versions et empreintes
  exactes des providers utilisés — évitant la dérive de configuration si
  deux membres de l'équipe, ou un pipeline CI, initialisaient le projet
  avec des versions différentes.
