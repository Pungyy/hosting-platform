ALTER TABLE servers
    ADD COLUMN cpu_usage NUMERIC(5,2),
    ADD COLUMN memory_usage NUMERIC(5,2),
    ADD COLUMN disk_usage NUMERIC(5,2),
    ADD COLUMN memory_total BIGINT,
    ADD COLUMN memory_used BIGINT,
    ADD COLUMN disk_total BIGINT,
    ADD COLUMN disk_used BIGINT,
    ADD COLUMN uptime_seconds BIGINT;