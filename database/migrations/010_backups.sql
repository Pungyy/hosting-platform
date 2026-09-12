CREATE TABLE backups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    database_id UUID NOT NULL,
    server_id UUID NOT NULL,
    filename VARCHAR(100) NOT NULL,
    size_bytes BIGINT,
    status VARCHAR(20) NOT NULL DEFAULT 'creating',
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT backups_status_check CHECK (status IN ('creating', 'completed', 'failed')),
    CONSTRAINT backups_database_fk FOREIGN KEY (database_id) REFERENCES databases(id) ON DELETE CASCADE,
    CONSTRAINT backups_server_fk FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE RESTRICT
);

CREATE INDEX idx_backups_database_id ON backups(database_id);
CREATE INDEX idx_backups_server_id ON backups(server_id);
