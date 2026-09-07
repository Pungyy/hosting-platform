INSERT INTO servers (
    name,
    hostname,
    status,
    agent_version
)
VALUES (
    'Local Docker',
    'localhost',
    'online',
    '0.1.0'
)
RETURNING *;