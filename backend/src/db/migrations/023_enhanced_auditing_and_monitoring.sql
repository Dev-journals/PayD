-- Enhanced Auditing and Monitoring Tables
-- Part of Issue #375 - Backend Robustness Part 50

-- API audit logs table for comprehensive request/response tracking
CREATE TABLE IF NOT EXISTS api_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id VARCHAR(255),
  user_email VARCHAR(255),
  organization_id INTEGER REFERENCES organizations(id),
  action VARCHAR(50) NOT NULL,
  resource VARCHAR(100) NOT NULL,
  resource_id VARCHAR(255),
  method VARCHAR(10) NOT NULL,
  path TEXT NOT NULL,
  ip_address VARCHAR(45),
  user_agent TEXT,
  request_body JSONB,
  response_status INTEGER,
  error_message TEXT,
  metadata JSONB,
  duration_ms INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX idx_api_audit_logs_org_id ON api_audit_logs(organization_id);
CREATE INDEX idx_api_audit_logs_user_id ON api_audit_logs(user_id);
CREATE INDEX idx_api_audit_logs_created_at ON api_audit_logs(created_at DESC);
CREATE INDEX idx_api_audit_logs_resource ON api_audit_logs(resource);
CREATE INDEX idx_api_audit_logs_action ON api_audit_logs(action);
CREATE INDEX idx_api_audit_logs_response_status ON api_audit_logs(response_status);

-- Sensitive operations audit table for critical actions
CREATE TABLE IF NOT EXISTS sensitive_operations_audit (
  id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  user_id VARCHAR(255),
  user_email VARCHAR(255),
  operation_type VARCHAR(100) NOT NULL,
  action VARCHAR(50) NOT NULL,
  resource VARCHAR(100) NOT NULL,
  method VARCHAR(10) NOT NULL,
  path TEXT NOT NULL,
  ip_address VARCHAR(45),
  user_agent TEXT,
  success BOOLEAN NOT NULL,
  status_code INTEGER,
  duration_ms INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sensitive_ops_audit_org_id ON sensitive_operations_audit(organization_id);
CREATE INDEX idx_sensitive_ops_audit_operation_type ON sensitive_operations_audit(operation_type);
CREATE INDEX idx_sensitive_ops_audit_created_at ON sensitive_operations_audit(created_at DESC);
CREATE INDEX idx_sensitive_ops_audit_success ON sensitive_operations_audit(success);

-- Tenant access logs for multi-tenant isolation monitoring
CREATE TABLE IF NOT EXISTS tenant_access_logs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES organizations(id),
  user_id VARCHAR(255),
  user_email VARCHAR(255),
  user_role VARCHAR(50),
  method VARCHAR(10) NOT NULL,
  path TEXT NOT NULL,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tenant_access_logs_tenant_id ON tenant_access_logs(tenant_id);
CREATE INDEX idx_tenant_access_logs_user_id ON tenant_access_logs(user_id);
CREATE INDEX idx_tenant_access_logs_created_at ON tenant_access_logs(created_at DESC);
CREATE INDEX idx_tenant_access_logs_ip_address ON tenant_access_logs(ip_address);

-- Rate limit bypass tokens table
CREATE TABLE IF NOT EXISTS rate_limit_bypass_tokens (
  id SERIAL PRIMARY KEY,
  token VARCHAR(255) UNIQUE NOT NULL,
  organization_id INTEGER REFERENCES organizations(id),
  user_id VARCHAR(255),
  expires_at TIMESTAMP NOT NULL,
  requests_remaining INTEGER,
  revoked BOOLEAN DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bypass_tokens_token ON rate_limit_bypass_tokens(token);
CREATE INDEX idx_bypass_tokens_org_id ON rate_limit_bypass_tokens(organization_id);
CREATE INDEX idx_bypass_tokens_expires_at ON rate_limit_bypass_tokens(expires_at);

-- Rate limit violations table for tracking and analysis
CREATE TABLE IF NOT EXISTS rate_limit_violations (
  id BIGSERIAL PRIMARY KEY,
  identifier VARCHAR(255) NOT NULL,
  tier VARCHAR(50) NOT NULL,
  organization_id INTEGER REFERENCES organizations(id),
  user_id VARCHAR(255),
  path TEXT NOT NULL,
  method VARCHAR(10) NOT NULL,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rate_limit_violations_org_id ON rate_limit_violations(organization_id);
CREATE INDEX idx_rate_limit_violations_identifier ON rate_limit_violations(identifier);
CREATE INDEX idx_rate_limit_violations_created_at ON rate_limit_violations(created_at DESC);
CREATE INDEX idx_rate_limit_violations_tier ON rate_limit_violations(tier);

-- Organization settings table for dynamic configurations
CREATE TABLE IF NOT EXISTS organization_settings (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER UNIQUE NOT NULL REFERENCES organizations(id),
  rate_limit_tier VARCHAR(50),
  max_api_calls_per_hour INTEGER,
  enable_advanced_security BOOLEAN DEFAULT false,
  ip_whitelist JSONB,
  ip_blacklist JSONB,
  custom_settings JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_org_settings_org_id ON organization_settings(organization_id);

-- Add columns to organizations table if they don't exist
ALTER TABLE organizations 
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS subscription_tier VARCHAR(50) DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(50) DEFAULT 'active';

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for organization_settings
CREATE TRIGGER update_organization_settings_updated_at
  BEFORE UPDATE ON organization_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE api_audit_logs IS 'Comprehensive audit trail for all API requests and responses';
COMMENT ON TABLE sensitive_operations_audit IS 'Audit log for critical operations like admin actions, deletions, etc.';
COMMENT ON TABLE tenant_access_logs IS 'Tracks tenant access patterns for security monitoring and anomaly detection';
COMMENT ON TABLE rate_limit_bypass_tokens IS 'Bypass tokens for high-priority operations that need to skip rate limiting';
COMMENT ON TABLE rate_limit_violations IS 'Records rate limit violations for analysis and abuse detection';
COMMENT ON TABLE organization_settings IS 'Organization-specific settings for rate limits and security configurations';

-- Grant permissions (adjust as needed for your setup)
-- GRANT SELECT, INSERT ON api_audit_logs TO app_user;
-- GRANT SELECT, INSERT ON sensitive_operations_audit TO app_user;
-- GRANT SELECT, INSERT ON tenant_access_logs TO app_user;
-- GRANT SELECT, INSERT, UPDATE ON rate_limit_bypass_tokens TO app_user;
-- GRANT SELECT, INSERT ON rate_limit_violations TO app_user;
-- GRANT SELECT, INSERT, UPDATE ON organization_settings TO app_user;
