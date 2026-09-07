ALTER TABLE deployments
    ADD COLUMN image_name VARCHAR(255),
    ADD COLUMN image_id VARCHAR(255),
    ADD COLUMN container_name VARCHAR(100),
    ADD COLUMN container_id VARCHAR(128);

CREATE INDEX idx_deployments_status
    ON deployments(status);