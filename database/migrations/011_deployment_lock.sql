-- Finding H1 (audit sécurité) : un site ne peut avoir qu'un seul
-- deployment 'running' à la fois. Contrainte vérifiée par Postgres
-- lui-même à l'INSERT (index unique partiel) : deux POST concurrents
-- ne peuvent jamais tous les deux réussir, quel que soit
-- l'ordonnancement exact des transactions. Une ligne sort de cet index
-- dès que son status change (success/failed/cancelled) — le verrou se
-- libère de lui-même, sans étape "unlock" séparée à appeler.
CREATE UNIQUE INDEX idx_deployments_one_running_per_site
    ON deployments (site_id)
    WHERE status = 'running';
