-- ============================================================
-- Hosting Platform
-- Migration 013 - Quotas de ressources par utilisateur (finding M3-1, audit sécurité)
-- ============================================================

-- Sans cette limite, un utilisateur authentifié pouvait créer un
-- nombre illimité de sites/bases de données (chacun réservant de la
-- RAM/CPU/disque sur l'hôte Docker PARTAGÉ entre tous les tenants) —
-- épuisement de ressources pouvant dégrader ou planter les containers
-- de TOUS les autres utilisateurs du même serveur.
--
-- Compteur dédié plutôt qu'un simple COUNT(*) sur sites/databases au
-- moment de la création : la réservation atomique conditionnelle (voir
-- lib/resources/quotas.ts) repose sur le verrou de ligne Postgres d'un
-- INSERT ... ON CONFLICT DO UPDATE ... WHERE — deux requêtes
-- concurrentes visant la MÊME ligne (user_id, resource_type) sont
-- nécessairement sérialisées par Postgres (la seconde attend que la
-- première commit/rollback avant de réévaluer la clause WHERE),
-- contrairement à un SELECT COUNT(*) suivi d'un INSERT séparé, où deux
-- transactions concurrentes peuvent toutes les deux lire l'ancienne
-- valeur avant qu'aucune n'ait committé.
CREATE TABLE user_resource_quotas (
    user_id UUID NOT NULL,

    resource_type VARCHAR(20) NOT NULL,

    count INT NOT NULL DEFAULT 0,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT user_resource_quotas_pk
        PRIMARY KEY (user_id, resource_type),

    CONSTRAINT user_resource_quotas_type_check
        CHECK (resource_type IN ('site', 'database')),

    CONSTRAINT user_resource_quotas_count_check
        CHECK (count >= 0),

    CONSTRAINT user_resource_quotas_user_fk
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);

-- Initialise le compteur à partir des ressources RÉELLEMENT existantes
-- au moment de cette migration — sans ce backfill, un utilisateur
-- ayant déjà créé plus de 10 sites/bases avant cette migration
-- repartirait à 0 et pourrait en créer 10 de plus.
INSERT INTO user_resource_quotas (user_id, resource_type, count)
SELECT user_id, 'site', COUNT(*)
FROM sites
GROUP BY user_id
ON CONFLICT (user_id, resource_type) DO NOTHING;

INSERT INTO user_resource_quotas (user_id, resource_type, count)
SELECT user_id, 'database', COUNT(*)
FROM databases
GROUP BY user_id
ON CONFLICT (user_id, resource_type) DO NOTHING;

-- ============================================================
-- Reproductibilité de l'environnement de test (revue indépendante)
-- ============================================================
--
-- Constat : contrairement à hosting_platform_user (base de dev/prod,
-- couvert par l'ALTER DEFAULT PRIVILEGES FOR ROLE regardscroises de la
-- migration 001), AUCUNE règle de privilèges par défaut n'a jamais
-- existé pour hosting_platform_test_user dans hosting_platform_test
-- (vérifié : SELECT * FROM pg_default_acl y renvoie 0 ligne). Chaque
-- nouvelle table créée par une migration (002 à 012) a donc nécessité
-- un GRANT manuel hors version, refait ici pour la table de cette
-- migration ET, de façon permanente, pour toutes les tables futures.
--
-- Gardé par current_database() = 'hosting_platform_test' — jamais par
-- une simple vérification d'existence du rôle : hosting_platform_test_user
-- existe au niveau du cluster Postgres (les rôles ne sont pas propres à
-- une base) et serait donc "trouvé" même en exécutant cette migration
-- contre hosting_platform. Un test d'existence du rôle accorderait par
-- erreur à hosting_platform_test_user un accès réel aux données de
-- hosting_platform — exactement la frontière que .env.test.example
-- documente comme volontairement absente (CONNECT hérité de PUBLIC,
-- mais aucun privilège sur les tables). Seul current_database() garantit
-- que ce bloc ne s'exécute JAMAIS ailleurs que dans hosting_platform_test.
--
-- GRANT et ALTER DEFAULT PRIVILEGES sont du DDL/DCL : PL/pgSQL exige de
-- les exécuter via EXECUTE (chaîne dynamique), ils ne peuvent pas être
-- écrits comme instruction directe dans un bloc DO.
DO $$
BEGIN
    IF current_database() = 'hosting_platform_test' THEN
        -- Besoin immédiat : la table que cette migration vient de créer.
        EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ' ||
                'ON user_resource_quotas ' ||
                'TO hosting_platform_test_user';

        -- Mécanisme permanent : toute table créée PAR LA SUITE par
        -- regardscroises dans hosting_platform_test (migrations 014+)
        -- accorde désormais automatiquement ces privilèges, sans
        -- nécessiter à nouveau un GRANT manuel hors version.
        EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE regardscroises ' ||
                'IN SCHEMA public ' ||
                'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES ' ||
                'TO hosting_platform_test_user';
    END IF;
END
$$;
