# TP1 — Module 2 : Gestion des configurations et Git

Castel Romain

## Exercice 2.1 — Initialiser un dépôt IaC dans les règles (p.?)

Objectif : dépôt avec `.gitattributes`, `.gitignore`, `README.md`,
`Makefile`, en 3 commits séparés (Conventional Commits) — un par sujet,
pas un fourre-tout.

Vérif faite avec `git show --stat` sur chaque commit : chacun ne touche
que ce qu'il annonce dans son message. Le commit
`chore: ajoute .gitattributes et .gitignore` ne bouge que ces deux
fichiers, pas plus.

## Exercice 2.2 — Faiblesse de l'identité Git, puis signature (p.?)

Étape 1 — usurpation : dans un dossier jetable, j'ai configuré git avec
le nom et l'email de Boris Rose, puis committé. `git log` affiche
l'identité usurpée sans aucune vérification. Les champs `user.name` /
`user.email` sont du texte libre côté client, rien ne les contrôle.
N'importe qui peut committer en se faisant passer pour n'importe qui.

Étape 2 — passage à la signature SSH avec une clé dédiée (`github-key`).
Deux usages distincts à déclarer côté GitHub pour la même clé :
Authentication Key (pour le push) et Signing Key (pour la vérification
des commits) — les deux ne sont pas automatiquement liées, il faut
ajouter la clé une seconde fois sous le bon type pour obtenir le badge
Verified.

Étape 3 — commit signé avec la vraie identité. `git log --show-signature
-1` confirme une Good signature.

**Q : la signature empêche-t-elle l'usurpation du champ Author ? Que
faut-il en plus côté serveur ?**

Non. Le champ Author reste du texte libre même avec un commit signé —
rien n'empêche d'écrire n'importe quel nom dedans. Ce que la signature
prouve, c'est autre chose : que le détenteur d'une clé privée précise a
produit ce commit. C'est vérifiable indépendamment du nom affiché.

Pour que ça serve à quelque chose, il faut, côté serveur (GitHub) :

- déclarer la clé publique comme signing key sur le compte, sinon pas de
  badge Verified même si la signature est valide ;
- activer "Require signed commits" sur la branche protégée, pour rejeter
  au push tout commit non signé ;
- ne pas s'arrêter là : la signature ne dit rien sur si le contenu est
  autorisé ou si la clé privée n'a pas été volée. Ça reste un maillon,
  pas une garantie à elle seule.

## TP1 — Dépôt IaC de bout en bout

Gouvernance mise en place sur une branche dédiée du dépôt principal
`terraform_v1`, plutôt qu'un nouveau dépôt séparé.

### Partie A — Initialisation

Ajout de `.gitattributes`, `.gitignore`, `.editorconfig`, `README.md` et
`Makefile` à la racine, sur la nouvelle branche. Le Makefile ne garde que
les cibles de gouvernance (`help`, `lint`, `secrets`) — pas de cibles
Terraform, puisque cette branche ne contient pas de configuration
d'infrastructure.

### Partie B — Garde-fous

Ajout de `.pre-commit-config.yaml` (fins de ligne, fichiers de fusion Git
oubliés, clés privées, scan gitleaks). Premier passage avec `pre-commit
run --all-files` pour valider la config avant de committer.

### Partie C — Provoquer la fuite

Valeurs utilisées : exemples publics officiels AWS
(`AKIAIOSFODNN7EXAMPLE...`), invalides par construction — jamais tester ça
avec une vraie clé.

Création d'un fichier `config/app.env` avec une fausse clé d'accès et une
fausse clé secrète AWS dedans. Tentative de commit normal : gitleaks
bloque, avec un rapport précisant le type de secret, le fichier et la
ligne concernés.

Contournement avec `--no-verify` : ça passe. Cette option désactive les
hooks côté client sans condition — n'importe qui pressé ou malveillant
peut la taper.

Lancement de `make secrets` ensuite : le secret est quand même détecté,
parce que cette commande scanne tout l'historique du dépôt, pas juste
l'état courant du répertoire de travail.

Purge de l'historique avec `git filter-repo` pour supprimer le fichier de
tous les commits. Vérification ensuite : la recherche du fichier dans
l'historique complet ne renvoie plus rien, il a bien disparu de tous les
commits et toutes les branches.

Le dépôt avait déjà été poussé avant la purge, donc un push forcé est
nécessaire après, et il faudrait prévenir toute personne ayant déjà
cloné le dépôt qu'elle doit le recloner entièrement.

Dans un cas réel avec une vraie clé, l'ordre est différent : révoquer la
clé chez AWS en premier, en générer une nouvelle, vérifier les journaux
d'usage (CloudTrail), et seulement après réécrire l'historique. La
réécriture, c'est du nettoyage, pas la remédiation.

### Partie D — Signature et protection

Signature SSH configurée avec une clé dédiée, déclarée sur GitHub à la
fois en Authentication Key (déjà utilisée pour le push) et en Signing Key
(ajout distinct nécessaire pour que les commits obtiennent le badge
Verified).

Commit de test poussé : badge Verified visible sur GitHub une fois la
clé déclarée sous le bon type.

Protection de la branche `master` activée : pull request obligatoire
avant fusion, une approbation minimum requise, commits signés
obligatoires, force push interdit, suppression de la branche interdite.
Cette protection n'a pu être activée qu'après être passé en dépôt
public — les règles de protection de branche sont limitées sur un dépôt
privé avec un compte gratuit.

Test de push direct sur `master` pour vérifier le refus : le push est
rejeté par GitHub avec un message listant plusieurs violations à la fois
(signature manquante, absence de pull request, branche verrouillée).

Pour repasser par le bon chemin après ce test : passer par une branche,
la pousser, puis ouvrir une Pull Request.

En complément, un pipeline GitHub Actions rejoue `pre-commit` côté
serveur à chaque push — un contrôle qui ne peut pas être contourné avec
`--no-verify`, contrairement au hook local.

## Réponses aux quatre questions

**1. Pourquoi `--no-verify` fonctionne-t-il, et quelle est la seule
parade réellement efficace ?**

`--no-verify` fonctionne parce que les hooks pre-commit tournent côté
client, en local, avant que le commit soit finalisé. Rien dans Git
n'oblige leur exécution — l'option est prévue nativement pour les
désactiver ponctuellement. Un dev pressé ou quelqu'un de malveillant
avec un accès local les contourne sans effort.

La seule parade qui tient : rejouer les mêmes vérifications côté
serveur, en CI, et rendre leur succès obligatoire via la protection de
branche. Un contrôle qui peut être contourné par un autre chemin n'est
pas un contrôle.

**2. Le secret purgé était-il, à un moment, présent sur le serveur
distant ? Qu'aurait-il fallu faire en premier s'il avait été réel ?**

Oui — le commit contenant le fichier a été poussé (après le
`--no-verify`) avant la purge, donc il a bien transité par GitHub et y a
résidé un moment.

Si le secret avait été réel, la toute première chose à faire, avant même
de toucher à Git, aurait été de le révoquer chez AWS, d'en générer un
nouveau, et de vérifier les journaux d'usage pour voir si quelqu'un s'en
était déjà servi. La réécriture d'historique vient après : c'est du
nettoyage, pas de la remédiation. La laisser passer pour l'inverse est
le vrai risque — le secret peut avoir déjà été récupéré par un scanner
automatique en quelques minutes.

**3. En quoi la mutabilité des tags Git explique-t-elle l'incident
tj-actions/changed-files ?**

Un tag Git pointe vers un commit, mais rien n'empêche de le réécrire
pour qu'il pointe ailleurs, tout en gardant le même nom lisible. C'est
exactement ce qui s'est passé lors de cet incident : après compromission
du jeton d'accès du bot du projet, l'attaquant a réécrit l'ensemble des
tags de version pour qu'ils pointent tous vers un commit malveillant.

Tous les dépôts qui référençaient cette action par un tag lisible ont
récupéré le code malveillant au run suivant, sans qu'aucune ligne de
leur propre configuration n'ait changé. Seuls les dépôts ayant épinglé
l'action par empreinte de commit complète étaient protégés, parce
qu'une empreinte de contenu est une identité immuable — la réécrire
changerait le hash lui-même. Un nom lisible est un pointeur mutable, une
empreinte de contenu est une identité.

**4. Citez trois éléments du dépôt qui relèvent de la gestion de
configuration au sens ITIL du terme.**

- Le dépôt Git dans son ensemble, en tant que CMDB exécutable : il
  recense les éléments de configuration et leurs relations, sans jamais
  pouvoir diverger de la réalité puisqu'il est ce qui construit
  effectivement le système.
- Chaque commit sur la branche protégée constitue une ligne de base
  (baseline) : un état de référence approuvé et figé, identifié par une
  empreinte infalsifiable, vers lequel on peut revenir en cas de
  problème.
- Le pipeline de gouvernance (pre-commit rejoué en CI), qui fige les
  règles de contrôle elles-mêmes dans un fichier versionné — évitant la
  dérive entre ce qui est vérifié en local et ce qui est réellement
  exigé avant fusion.
