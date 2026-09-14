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
