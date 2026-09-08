-- ============================================================
-- Hosting Platform
-- Migration 007 - Panel authentication
-- ============================================================

-- ============================================================
-- USERS
-- ============================================================

ALTER TABLE users
ADD COLUMN password_hash VARCHAR(255);

-- ============================================================
-- SESSIONS
-- ============================================================

CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL,

    token_hash VARCHAR(64) NOT NULL UNIQUE,

    expires_at TIMESTAMPTZ NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT sessions_user_fk
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);

CREATE INDEX sessions_user_id_idx
    ON sessions(user_id);

CREATE INDEX sessions_expires_at_idx
    ON sessions(expires_at);

-- ============================================================
-- COMMENTS
-- ============================================================

COMMENT ON COLUMN users.password_hash IS
    'Argon2id hash of the user password.';

COMMENT ON COLUMN sessions.token_hash IS
    'SHA-256 hash of the session token. The raw token is only stored in the browser cookie.';
