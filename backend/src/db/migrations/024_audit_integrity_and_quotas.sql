-- =============================================================================
-- Migration 024: Audit Log Integrity, Platform Admin Access Logs, and
--                Tenant Resource Quotas
-- Part of Issue #294 - API & Database Scaling Part 49
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Audit log hash chain columns (tamper-evident ledger)
-- ---------------------------------------------------------------------------

ALTER TABLE api_audit_logs
  ADD COLUMN IF NOT EXISTS row_hash   VARCHAR(64),
  ADD COLUMN IF NOT EXISTS chain_hash VARCHAR(64);

-- Index on chain_hash so integrity verification can walk the chain efficiently
CREATE INDEX IF NOT EXISTS idx_api_audit_logs_chain_hash ON api_audit_logs(id, chain_hash);

-- Trigger function: compute row_hash on INSERT and chain it to previous row
CREATE OR REPLACE FUNCTION compute_audit_chain_hash()
RETURNS TRIGGER AS $$
DECLARE
  prev_chain_hash VARCHAR(64);
  row_data        TEXT;
BEGIN
  -- Build a deterministic string from the immutable columns of this row
  row_data := COALESCE(NEW.user_id, '')
    || '|' || COALESCE(NEW.user_email, '')
    || '|' || COALESCE(NEW.organization_id::TEXT, '')
    || '|' || NEW.action
    || '|' || NEW.resource
    || '|' || COALESCE(NEW.resource_id, '')
    || '|' || NEW.method
    || '|' || NEW.path
    || '|' || COALESCE(NEW.response_status::TEXT, '')
    || '|' || NEW.created_at::TEXT;

  -- SHA-256 of the row data
  NEW.row_hash := encode(digest(row_data, 'sha256'), 'hex');

  -- Fetch the chain_hash of the immediately preceding row (by id)
  SELECT chain_hash INTO prev_chain_hash
  FROM api_audit_logs
  WHERE id = (SELECT MAX(id) FROM api_audit_logs);

  -- Chain: SHA-256(current row_hash || previous chain_hash)
  NEW.chain_hash := encode(
    digest(NEW.row_hash || COALESCE(prev_chain_hash, 'genesis'), 'sha256'),
    'hex'
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Requires pgcrypto for digest()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP TRIGGER IF EXISTS trg_audit_chain_hash ON api_audit_logs;
CREATE TRIGGER trg_audit_chain_hash
  BEFORE INSERT ON api_audit_logs
  FOR EACH ROW EXECUTE FUNCTION compute_audit_chain_hash();

-- Prevent any UPDATE or DELETE on api_audit_logs (append-only enforcement)
CREATE OR REPLACE FUNCTION deny_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit log rows are immutable — UPDATE and DELETE are not permitted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_deny_audit_update ON api_audit_logs;
CREATE TRIGGER trg_deny_audit_update
  BEFORE UPDATE OR DELETE ON api_audit_logs
  FOR EACH ROW EXECUTE FUNCTION deny_audit_log_mutation();

-- ---------------------------------------------------------------------------
-- 2. Platform admin cross-tenant access logs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform_admin_access_logs (
  id               BIGSERIAL    PRIMARY KEY,
  admin_user_id    VARCHAR(255) NOT NULL,
  admin_email      VARCHAR(255),
  target_org_id    INTEGER      NOT NULL REFERENCES organizations(id),
  justification    TEXT         NOT NULL,
  action           VARCHAR(50)  NOT NULL,
  resource         VARCHAR(100) NOT NULL,
  resource_id      VARCHAR(255),
  method           VARCHAR(10)  NOT NULL,
  path             TEXT         NOT NULL,
  ip_address       VARCHAR(45),
  user_agent       TEXT,
  session_id       VARCHAR(255),
  response_status  INTEGER,
  created_at       TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_platform_admin_access_admin   ON platform_admin_access_logs(admin_user_id);
CREATE INDEX idx_platform_admin_access_org     ON platform_admin_access_logs(target_org_id);
CREATE INDEX idx_platform_admin_access_created ON platform_admin_access_logs(created_at DESC);

COMMENT ON TABLE platform_admin_access_logs IS
  'Immutable record of every cross-tenant access by a platform administrator, including mandatory justification.';

-- ---------------------------------------------------------------------------
-- 3. Tenant resource quotas on organization_settings
-- ---------------------------------------------------------------------------

ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS max_employees            INTEGER   DEFAULT 500,
  ADD COLUMN IF NOT EXISTS max_monthly_transactions INTEGER   DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS max_storage_mb           INTEGER   DEFAULT 1024,
  ADD COLUMN IF NOT EXISTS quota_alert_threshold    NUMERIC(4,3) DEFAULT 0.80;

-- ---------------------------------------------------------------------------
-- 4. Tenant usage snapshots (daily rollup for billing / capacity planning)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenant_usage_snapshots (
  id               BIGSERIAL PRIMARY KEY,
  organization_id  INTEGER   NOT NULL REFERENCES organizations(id),
  snapshot_date    DATE      NOT NULL,
  employee_count   INTEGER   NOT NULL DEFAULT 0,
  transaction_count BIGINT   NOT NULL DEFAULT 0,
  storage_bytes    BIGINT    NOT NULL DEFAULT 0,
  api_calls        BIGINT    NOT NULL DEFAULT 0,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, snapshot_date)
);

CREATE INDEX idx_tenant_usage_snapshots_org  ON tenant_usage_snapshots(organization_id);
CREATE INDEX idx_tenant_usage_snapshots_date ON tenant_usage_snapshots(snapshot_date DESC);

COMMENT ON TABLE tenant_usage_snapshots IS
  'Daily per-tenant usage rollup — employee count, transaction volume, storage, and API calls. Used for quota tracking and usage-based billing.';

-- ---------------------------------------------------------------------------
-- 5. Per-tenant rate limit overrides (stored in tenant_configurations)
-- ---------------------------------------------------------------------------

-- Insert default placeholder rows so application code can UPSERT safely
-- (actual values are set by the admin API, not hardcoded here)
INSERT INTO tenant_configurations (organization_id, config_key, config_value, description)
SELECT o.id,
       'rate_limit_overrides',
       '{"api":{"windowMs":60000,"maxRequests":100},"auth":{"windowMs":900000,"maxRequests":10},"data":{"windowMs":60000,"maxRequests":200},"strict":{"windowMs":60000,"maxRequests":20}}'::jsonb,
       'Per-tenant rate limit tier overrides. Null values fall back to global defaults.'
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM tenant_configurations tc
  WHERE tc.organization_id = o.id AND tc.config_key = 'rate_limit_overrides'
)
ON CONFLICT DO NOTHING;
