-- ============================================================
-- Hosting Platform
-- Migration 001 - Initial schema
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- USERS
-- ============================================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    email VARCHAR(255) NOT NULL UNIQUE,

    name VARCHAR(120) NOT NULL,

    role VARCHAR(30) NOT NULL DEFAULT 'user',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT users_role_check
        CHECK (role IN ('user', 'admin'))
);

-- ============================================================
-- SERVERS
-- ============================================================

CREATE TABLE servers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name VARCHAR(100) NOT NULL,

    hostname VARCHAR(255) NOT NULL,

    ip_address INET,

    status VARCHAR(30) NOT NULL DEFAULT 'offline',

    agent_version VARCHAR(50),

    last_seen_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT servers_status_check
        CHECK (
            status IN (
                'online',
                'offline',
                'maintenance',
                'error'
            )
        )
);

-- ============================================================
-- SITES
-- ============================================================

CREATE TABLE sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL,

    server_id UUID NOT NULL,

    name VARCHAR(40) NOT NULL,

    container_name VARCHAR(100) NOT NULL,

    container_id VARCHAR(128),

    image VARCHAR(255) NOT NULL,

    status VARCHAR(30) NOT NULL DEFAULT 'creating',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT sites_name_check
        CHECK (
            name ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
        ),

    CONSTRAINT sites_status_check
        CHECK (
            status IN (
                'creating',
                'online',
                'stopped',
                'deploying',
                'error',
                'suspended'
            )
        ),

    CONSTRAINT sites_user_fk
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT sites_server_fk
        FOREIGN KEY (server_id)
        REFERENCES servers(id)
        ON DELETE RESTRICT,

    CONSTRAINT sites_container_name_unique
        UNIQUE (container_name)
);

-- ============================================================
-- DOMAINS
-- ============================================================

CREATE TABLE domains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    site_id UUID NOT NULL,

    domain VARCHAR(255) NOT NULL UNIQUE,

    is_primary BOOLEAN NOT NULL DEFAULT FALSE,

    ssl_enabled BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT domains_site_fk
        FOREIGN KEY (site_id)
        REFERENCES sites(id)
        ON DELETE CASCADE
);

-- ============================================================
-- DEPLOYMENTS
-- ============================================================

CREATE TABLE deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    site_id UUID NOT NULL,

    commit_sha VARCHAR(64),

    branch VARCHAR(255),

    status VARCHAR(30) NOT NULL DEFAULT 'pending',

    started_at TIMESTAMPTZ,

    finished_at TIMESTAMPTZ,

    logs TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT deployments_site_fk
        FOREIGN KEY (site_id)
        REFERENCES sites(id)
        ON DELETE CASCADE,

    CONSTRAINT deployments_status_check
        CHECK (
            status IN (
                'pending',
                'running',
                'success',
                'failed',
                'cancelled'
            )
        )
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_sites_user_id
    ON sites(user_id);

CREATE INDEX idx_sites_server_id
    ON sites(server_id);

CREATE INDEX idx_sites_status
    ON sites(status);

CREATE INDEX idx_domains_site_id
    ON domains(site_id);

CREATE INDEX idx_deployments_site_id
    ON deployments(site_id);

CREATE INDEX idx_deployments_created_at
    ON deployments(created_at DESC);

-- ============================================================
-- PERMISSIONS
-- ============================================================

GRANT USAGE ON SCHEMA public
    TO hosting_platform_user;

GRANT SELECT, INSERT, UPDATE, DELETE
    ON ALL TABLES IN SCHEMA public
    TO hosting_platform_user;

ALTER DEFAULT PRIVILEGES
    FOR ROLE regardscroises
    IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLES
    TO hosting_platform_user;