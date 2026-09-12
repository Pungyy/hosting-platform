
-- ============================================================
-- Hosting Platform
-- Migration 009 - Databases (provisioning)
-- ============================================================

CREATE TABLE databases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL,

    server_id UUID NOT NULL,

    name VARCHAR(40) NOT NULL,

    engine VARCHAR(20) NOT NULL DEFAULT 'postgres',

    container_name VARCHAR(100) NOT NULL,

    container_id VARCHAR(128),

    image VARCHAR(255) NOT NULL,

    status VARCHAR(30) NOT NULL DEFAULT 'creating',

    database_name VARCHAR(63) NOT NULL,

    username VARCHAR(63) NOT NULL,

    password_encrypted TEXT NOT NULL,

    -- Nom résolvable dans le réseau Docker `hosting-sites` (= container_name).
    internal_host VARCHAR(100) NOT NULL,

    internal_port INTEGER NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT databases_name_check
        CHECK (
            name ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
        ),

    CONSTRAINT databases_engine_check
        CHECK (
            engine IN ('postgres')
        ),

    CONSTRAINT databases_status_check
        CHECK (
            status IN (
                'creating',
                'online',
                'stopped',
                'error'
            )
        ),

    CONSTRAINT databases_user_fk
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT databases_server_fk
        FOREIGN KEY (server_id)
        REFERENCES servers(id)
        ON DELETE RESTRICT,

    CONSTRAINT databases_container_name_unique
        UNIQUE (container_name)
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_databases_user_id
    ON databases(user_id);

CREATE INDEX idx_databases_server_id
    ON databases(server_id);
