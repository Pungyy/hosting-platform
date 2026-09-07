ALTER TABLE servers
    ADD COLUMN enrollment_token_hash VARCHAR(255),
    ADD COLUMN enrollment_token_expires_at TIMESTAMPTZ,
    ADD COLUMN enrolled_at TIMESTAMPTZ;

CREATE INDEX idx_servers_enrollment_token_hash
    ON servers(enrollment_token_hash);  