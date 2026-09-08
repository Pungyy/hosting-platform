-- ============================================================
-- Hosting Platform
-- Migration 008 - Agent connection
-- ============================================================

ALTER TABLE servers
    ADD COLUMN agent_url VARCHAR(500),
    ADD COLUMN agent_token_encrypted TEXT;
