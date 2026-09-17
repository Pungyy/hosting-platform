#!/usr/bin/env bash
set -euo pipefail

# Exécuté automatiquement par l'image officielle PostgreSQL via
# /docker-entrypoint-initdb.d/ — UNIQUEMENT lors de la toute première
# initialisation d'un volume de données vide (mécanisme natif de
# l'image ; jamais rejoué sur un cluster déjà initialisé, donc jamais
# sur le container actuellement en production). Reproduit exactement
# la procédure de bootstrap manuelle documentée dans compose.yaml :
#
#   1. Création de hosting_platform_migrator et hosting_platform_app,
#      tous deux NOSUPERUSER/NOCREATEDB/NOCREATEROLE dès leur création
#      — jamais superuser, à aucun moment. Idempotent (IF NOT EXISTS
#      via un bloc DO, PostgreSQL n'a pas de CREATE ROLE IF NOT EXISTS
#      natif).
#   2. Transfert de la propriété de la base ET du schéma public vers
#      hosting_platform_migrator — c'est ce qui lui permet d'exécuter
#      les migrations sans jamais avoir besoin de privilèges élevés.
#      hosting_platform_migrator n'est JAMAIS utilisé comme
#      POSTGRES_USER (le bootstrap reste "postgres", superuser inhérent
#      à PostgreSQL — voir compose.yaml). hosting_platform_app n'est
#      jamais utilisé comme bootstrap.
#   3. Création de pgcrypto (nécessaire à la migration 001), faite ici
#      pendant que "postgres" est encore superuser — idempotent
#      (IF NOT EXISTS natif de CREATE EXTENSION).
#
# Échappement SQL sûr (ne dépend pas du fait que les mots de passe
# actuels soient hexadécimaux) :
#   - Le heredoc utilise un délimiteur QUOTÉ (<<-'EOSQL'), donc bash ne
#     fait AUCUNE interpolation dans le SQL — aucune valeur ne transite
#     par une substitution de chaîne shell.
#   - `\getenv` (méta-commande psql, PostgreSQL >= 10) lit chaque
#     secret directement depuis l'environnement du process vers une
#     variable psql — un mot de passe n'apparaît donc jamais sur une
#     ligne de commande / argv (même exposition que POSTGRES_PASSWORD
#     lui-même, déjà géré ainsi par l'image officielle).
#   - `:'variable'` fait échapper la valeur comme littéral SQL
#     (équivalent quote_literal) : utilisé pour les mots de passe et
#     pour la comparaison de rolname (chaîne).
#   - `:"variable"` fait échapper la valeur comme identifiant SQL
#     (équivalent quote_ident) : utilisé pour les noms de rôles et de
#     base. Ces deux mécanismes sont gérés par psql/libpq et échappent
#     correctement guillemets/antislashs quel que soit le contenu réel
#     du secret.
#   - Aucune commande ici n'affiche la valeur d'un mot de passe (pas de
#     `set -x`, pas d'echo d'une variable *_PASSWORD, pas de \echo des
#     variables psql).
#
# Idempotence des mots de passe (choix explicite) : si un rôle existe
# déjà, ce script NE modifie PAS son mot de passe — seule la création
# initiale est idempotente. Si le script était réexécuté manuellement
# contre un cluster déjà initialisé (en dehors du mécanisme
# /docker-entrypoint-initdb.d/, qui ne le rejoue de toute façon jamais
# automatiquement), les identifiants d'un rôle déjà présent restent
# inchangés — choix délibéré pour ne jamais écraser silencieusement un
# mot de passe en production.

: "${POSTGRES_DB:?POSTGRES_DB manquant}"
: "${POSTGRES_MIGRATOR_USER:?POSTGRES_MIGRATOR_USER manquant}"
: "${POSTGRES_MIGRATOR_PASSWORD:?POSTGRES_MIGRATOR_PASSWORD manquant}"
: "${POSTGRES_APP_USER:?POSTGRES_APP_USER manquant}"
: "${POSTGRES_APP_PASSWORD:?POSTGRES_APP_PASSWORD manquant}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-'EOSQL'
	\getenv db POSTGRES_DB
	\getenv migrator_user POSTGRES_MIGRATOR_USER
	\getenv migrator_password POSTGRES_MIGRATOR_PASSWORD
	\getenv app_user POSTGRES_APP_USER
	\getenv app_password POSTGRES_APP_PASSWORD

	DO $$
	BEGIN
	  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'migrator_user') THEN
	    CREATE ROLE :"migrator_user"
	      WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
	      PASSWORD :'migrator_password';
	  END IF;
	END
	$$;

	DO $$
	BEGIN
	  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'app_user') THEN
	    CREATE ROLE :"app_user"
	      WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
	      PASSWORD :'app_password';
	  END IF;
	END
	$$;

	ALTER DATABASE :"db" OWNER TO :"migrator_user";
	ALTER SCHEMA public OWNER TO :"migrator_user";

	CREATE EXTENSION IF NOT EXISTS pgcrypto;
EOSQL

echo "01-bootstrap-roles.sh: rôles applicatifs et propriété initialisés (mots de passe jamais affichés)."
