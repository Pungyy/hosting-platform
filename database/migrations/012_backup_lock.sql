-- Finding M2 (audit sécurité) : une base ne peut avoir qu'une seule
-- sauvegarde 'creating' à la fois. Contrainte vérifiée par Postgres
-- lui-même à l'INSERT (index unique partiel), même mécanisme que
-- idx_deployments_one_running_per_site (finding H1, migration 011) :
-- deux POST concurrents ne peuvent jamais tous les deux réussir, quel
-- que soit l'ordonnancement exact des transactions. Une ligne sort de
-- cet index dès que son status change (completed/failed) — le verrou
-- se libère de lui-même, sans étape "unlock" séparée à appeler.
CREATE UNIQUE INDEX idx_backups_one_creating_per_database
    ON backups (database_id)
    WHERE status = 'creating';
