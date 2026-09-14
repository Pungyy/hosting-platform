-- ============================================================
-- Hosting Platform
-- Migration 014 - Plafond de déploiements concurrents par tenant (finding M3-2, audit sécurité)
-- ============================================================

-- Le verrou H1 (idx_deployments_one_running_per_site, migration 011)
-- garantit qu'un SITE ne peut avoir qu'un seul deployment 'running' à
-- la fois, mais n'a aucune portée cross-site : un tenant possédant
-- plusieurs sites (jusqu'à 10, voir finding M3-1) pouvait déclencher un
-- build Docker (jusqu'à 1 Gio RAM / 1.0 CPU chacun, voir
-- apps/agent/src/services/deployment.ts) simultanément sur CHACUN de
-- ses sites, sans aucune limite — risque de contention mémoire réelle
-- sur l'hôte Docker partagé entre tenants (l'OOM killer Linux peut
-- alors tuer n'importe quel process de l'hôte, y compris les
-- containers d'AUTRES tenants qui n'ont rien demandé).
--
-- Compteur dédié et SÉPARÉ de user_resource_quotas (finding M3-1) :
-- sémantique fondamentalement différente. user_resource_quotas est un
-- total historique (jamais décrémenté à la suppression d'une
-- ressource) ; tenant_deployment_slots reflète EXCLUSIVEMENT le nombre
-- de deployments ACTUELLEMENT 'running' pour ce tenant — incrémenté à
-- l'acquisition du verrou H1, décrémenté dès que le deployment quitte
-- 'running' (succès, échec, timeout, ou réclamation d'un verrou
-- orphelin). Mélanger les deux sémantiques dans une même table aurait
-- rendu le CHECK resource_type et le raisonnement sur chacune plus
-- difficiles à auditer séparément — voir lib/resources/deployments.ts
-- pour le mécanisme complet (acquireTenantDeploymentSlot /
-- releaseTenantDeploymentSlot).
--
-- Même mécanisme d'atomicité que M3-1 : INSERT ... ON CONFLICT DO
-- UPDATE ... WHERE count < limite RETURNING — le verrou de ligne
-- Postgres sur (user_id) sérialise toute paire de requêtes concurrentes
-- pour le même tenant, rendant un dépassement de la limite impossible
-- quel que soit l'ordonnancement.
--
-- Aucun backfill nécessaire (contrairement à 013) : par construction,
-- aucun deployment ne peut être 'running' au moment où une migration
-- s'applique (vérifié : SELECT * FROM deployments WHERE status =
-- 'running' sur hosting_platform ne renvoie aucune ligne avant cette
-- migration) — chaque ligne de ce compteur est créée à la demande, au
-- premier déploiement de chaque tenant.
--
-- Privilèges hosting_platform_test_user : couverts automatiquement par
-- le mécanisme ALTER DEFAULT PRIVILEGES permanent posé dans la
-- migration 013 (correction M3-1) — aucun GRANT supplémentaire requis
-- ici, c'est précisément l'objectif de ce mécanisme. Vérifié après
-- application de cette migration (voir rapport M3-2).
CREATE TABLE tenant_deployment_slots (
    user_id UUID PRIMARY KEY,

    count INT NOT NULL DEFAULT 0,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT tenant_deployment_slots_count_check
        CHECK (count >= 0),

    CONSTRAINT tenant_deployment_slots_user_fk
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);
