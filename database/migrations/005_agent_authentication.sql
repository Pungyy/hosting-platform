ALTER TABLE servers
    ADD COLUMN agent_token_hash VARCHAR(255);

CREATE INDEX idx_servers_agent_token_hash
    ON servers(agent_token_hash);