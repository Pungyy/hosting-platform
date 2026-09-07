-- ============================================================
-- Hosting Platform
-- Migration 002 - GitHub deployment
-- ============================================================

-- ============================================================
-- SITES - GITHUB CONFIGURATION
-- ============================================================

ALTER TABLE sites
    ADD COLUMN repository_url VARCHAR(500),
    ADD COLUMN repository_branch VARCHAR(255) DEFAULT 'main',
    ADD COLUMN build_path VARCHAR(500) DEFAULT '.';

-- ============================================================
-- CONSTRAINTS
-- ============================================================

ALTER TABLE sites
    ADD CONSTRAINT sites_repository_url_check
        CHECK (
            repository_url IS NULL
            OR repository_url ~ '^https://github\.com/[^/]+/[^/]+(?:\.git)?$'
        );

ALTER TABLE sites
    ADD CONSTRAINT sites_repository_branch_check
        CHECK (
            repository_branch IS NULL
            OR repository_branch ~ '^[A-Za-z0-9._/-]+$'
        );

-- ============================================================
-- INDEX
-- ============================================================

CREATE INDEX idx_sites_repository_url
    ON sites(repository_url);
