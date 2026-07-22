-- Idempotency keys table for write-path deduplication.
-- Scoped to tenant (organization_id) so two orgs using the same key don't collide.
-- TTL is enforced at the application layer; the index supports efficient lookup.

CREATE TABLE IF NOT EXISTS idempotency_keys (
    id              SERIAL       PRIMARY KEY,
    organization_id INTEGER      NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    idempotency_key VARCHAR(255) NOT NULL,
    status          VARCHAR(20)  NOT NULL DEFAULT 'in_progress'
                        CHECK (status IN ('in_progress', 'completed', 'failed')),
    response_status INTEGER,
    response_body   JSONB,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ  NOT NULL,
    UNIQUE (organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_lookup
    ON idempotency_keys (organization_id, idempotency_key, expires_at);

-- Auto-cleanup of expired keys (TTL enforced by expires_at comparison).
-- Runs at table level; the application also checks expires_at on read.
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires
    ON idempotency_keys (expires_at)
    WHERE expires_at < NOW();
