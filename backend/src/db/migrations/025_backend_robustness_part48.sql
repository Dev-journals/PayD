-- Migration: Backend Robustness Enhancement - Part 48
-- Description: Enhanced auditing, rate limiting, and multi-tenant security
-- Author: Backend Team
-- Date: 2024-01-15

-- ============================================================================
-- 1. REQUEST AUDIT LOGS
-- ============================================================================
-- Comprehensive tracking of all API requests for security and compliance

CREATE TABLE IF NOT EXISTS request_audit_logs (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    request_id VARCHAR(64) NOT NULL UNIQUE,
    method VARCHAR(10) NOT NULL,
    path TEXT NOT NULL,
    query_params JSONB,
    request_body JSONB,
    response_status INTEGER,
    response_body JSONB,
    ip_address INET,
    user_agent TEXT,
    request_duration_ms INTEGER,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    indexed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for efficient querying
CREATE INDEX idx_request_audit_org_id ON request_audit_logs(organization_id);
CREATE INDEX idx_request_audit_user_id ON request_audit_logs(user_id);
CREATE INDEX idx_request_audit_created_at ON request_audit_logs(created_at DESC);
CREATE INDEX idx_request_audit_path ON request_audit_logs(path);
CREATE INDEX idx_request_audit_status ON request_audit_logs(response_status);
CREATE INDEX idx_request_audit_ip ON request_audit_logs(ip_address);

-- ============================================================================
-- 2. CRITICAL OPERATIONS AUDIT
-- ============================================================================
-- Special audit trail for high-risk operations (deletions, permission changes, etc.)

CREATE TABLE IF NOT EXISTS critical_operations_audit (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    operation_type VARCHAR(100) NOT NULL,
    operation_category VARCHAR(50) NOT NULL, -- 'delete', 'permission', 'financial', 'configuration'
    resource_type VARCHAR(100) NOT NULL,
    resource_id VARCHAR(255),
    before_state JSONB,
    after_state JSONB,
    justification TEXT,
    ip_address INET,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_critical_ops_org_id ON critical_operations_audit(organization_id);
CREATE INDEX idx_critical_ops_user_id ON critical_operations_audit(user_id);
CREATE INDEX idx_critical_ops_created_at ON critical_operations_audit(created_at DESC);
CREATE INDEX idx_critical_ops_category ON critical_operations_audit(operation_category);
CREATE INDEX idx_critical_ops_type ON critical_operations_audit(operation_type);

-- ============================================================================
-- 3. RATE LIMIT TRACKING
-- ============================================================================
-- Track rate limit usage and violations for analysis

CREATE TABLE IF NOT EXISTS rate_limit_tracking (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    user_id INTEGER,
    ip_address INET,
    endpoint_pattern VARCHAR(255) NOT NULL,
    rate_limit_tier VARCHAR(50) NOT NULL, -- 'free', 'standard', 'premium', 'enterprise'
    requests_count INTEGER NOT NULL DEFAULT 0,
    window_start TIMESTAMP WITH TIME ZONE NOT NULL,
    window_end TIMESTAMP WITH TIME ZONE NOT NULL,
    limit_reached BOOLEAN DEFAULT FALSE,
    violations_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_rate_limit_org_id ON rate_limit_tracking(organization_id);
CREATE INDEX idx_rate_limit_ip ON rate_limit_tracking(ip_address);
CREATE INDEX idx_rate_limit_window ON rate_limit_tracking(window_start, window_end);
CREATE INDEX idx_rate_limit_violations ON rate_limit_tracking(violations_count) WHERE violations_count > 0;

-- ============================================================================
-- 4. RATE LIMIT BYPASS CREDENTIALS
-- ============================================================================
-- Tokens for bypassing rate limits (for integrations, high-priority operations)

CREATE TABLE IF NOT EXISTS rate_limit_bypass_credentials (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    token_prefix VARCHAR(10) NOT NULL, -- First few chars for identification
    description TEXT,
    max_requests INTEGER, -- NULL = unlimited
    requests_used INTEGER DEFAULT 0,
    valid_from TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    valid_until TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE,
    last_used_at TIMESTAMP WITH TIME ZONE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_bypass_token_hash ON rate_limit_bypass_credentials(token_hash);
CREATE INDEX idx_bypass_org_id ON rate_limit_bypass_credentials(organization_id);
CREATE INDEX idx_bypass_active ON rate_limit_bypass_credentials(is_active) WHERE is_active = TRUE;

-- ============================================================================
-- 5. TENANT ACCESS MONITORING
-- ============================================================================
-- Monitor cross-tenant access patterns for security

CREATE TABLE IF NOT EXISTS tenant_access_monitoring (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    accessed_organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    access_type VARCHAR(50) NOT NULL, -- 'read', 'write', 'delete', 'admin'
    resource_type VARCHAR(100) NOT NULL,
    resource_id VARCHAR(255),
    access_granted BOOLEAN NOT NULL,
    denial_reason TEXT,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tenant_access_org_id ON tenant_access_monitoring(organization_id);
CREATE INDEX idx_tenant_access_accessed_org ON tenant_access_monitoring(accessed_organization_id);
CREATE INDEX idx_tenant_access_user_id ON tenant_access_monitoring(user_id);
CREATE INDEX idx_tenant_access_created_at ON tenant_access_monitoring(created_at DESC);
CREATE INDEX idx_tenant_access_denied ON tenant_access_monitoring(access_granted) WHERE access_granted = FALSE;

-- ============================================================================
-- 6. SECURITY EVENTS
-- ============================================================================
-- Log security-relevant events for threat detection

CREATE TABLE IF NOT EXISTS security_events (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    event_type VARCHAR(100) NOT NULL, -- 'suspicious_access', 'brute_force', 'privilege_escalation', etc.
    severity VARCHAR(20) NOT NULL, -- 'low', 'medium', 'high', 'critical'
    description TEXT NOT NULL,
    ip_address INET,
    user_agent TEXT,
    metadata JSONB,
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_security_events_org_id ON security_events(organization_id);
CREATE INDEX idx_security_events_user_id ON security_events(user_id);
CREATE INDEX idx_security_events_type ON security_events(event_type);
CREATE INDEX idx_security_events_severity ON security_events(severity);
CREATE INDEX idx_security_events_unresolved ON security_events(resolved) WHERE resolved = FALSE;
CREATE INDEX idx_security_events_created_at ON security_events(created_at DESC);

-- ============================================================================
-- 7. ORGANIZATION RATE LIMIT TIERS
-- ============================================================================
-- Store organization-specific rate limit configurations

CREATE TABLE IF NOT EXISTS organization_rate_limits (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
    tier VARCHAR(50) NOT NULL DEFAULT 'standard', -- 'free', 'standard', 'premium', 'enterprise', 'custom'
    requests_per_minute INTEGER DEFAULT 60,
    requests_per_hour INTEGER DEFAULT 1000,
    requests_per_day INTEGER DEFAULT 10000,
    burst_allowance INTEGER DEFAULT 10, -- Extra requests allowed in short bursts
    custom_limits JSONB, -- Endpoint-specific overrides
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_org_rate_limits_org_id ON organization_rate_limits(organization_id);
CREATE INDEX idx_org_rate_limits_tier ON organization_rate_limits(tier);

-- ============================================================================
-- 8. DATA RETENTION POLICY
-- ============================================================================
-- Automatic cleanup of old audit logs based on retention policies

CREATE TABLE IF NOT EXISTS audit_retention_policies (
    id SERIAL PRIMARY KEY,
    table_name VARCHAR(100) NOT NULL UNIQUE,
    retention_days INTEGER NOT NULL,
    last_cleanup_at TIMESTAMP WITH TIME ZONE,
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Default retention policies
INSERT INTO audit_retention_policies (table_name, retention_days) VALUES
    ('request_audit_logs', 90),
    ('critical_operations_audit', 365),
    ('rate_limit_tracking', 30),
    ('tenant_access_monitoring', 90),
    ('security_events', 180)
ON CONFLICT (table_name) DO NOTHING;

-- ============================================================================
-- 9. FUNCTIONS AND TRIGGERS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to relevant tables
CREATE TRIGGER update_rate_limit_tracking_updated_at
    BEFORE UPDATE ON rate_limit_tracking
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_rate_limit_bypass_updated_at
    BEFORE UPDATE ON rate_limit_bypass_credentials
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_org_rate_limits_updated_at
    BEFORE UPDATE ON organization_rate_limits
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to clean up old audit logs based on retention policy
CREATE OR REPLACE FUNCTION cleanup_old_audit_logs()
RETURNS TABLE(table_name VARCHAR, rows_deleted BIGINT) AS $$
DECLARE
    policy RECORD;
    deleted_count BIGINT;
BEGIN
    FOR policy IN 
        SELECT * FROM audit_retention_policies 
        WHERE enabled = TRUE
    LOOP
        CASE policy.table_name
            WHEN 'request_audit_logs' THEN
                DELETE FROM request_audit_logs 
                WHERE created_at < CURRENT_TIMESTAMP - (policy.retention_days || ' days')::INTERVAL;
                GET DIAGNOSTICS deleted_count = ROW_COUNT;
            WHEN 'critical_operations_audit' THEN
                DELETE FROM critical_operations_audit 
                WHERE created_at < CURRENT_TIMESTAMP - (policy.retention_days || ' days')::INTERVAL;
                GET DIAGNOSTICS deleted_count = ROW_COUNT;
            WHEN 'rate_limit_tracking' THEN
                DELETE FROM rate_limit_tracking 
                WHERE created_at < CURRENT_TIMESTAMP - (policy.retention_days || ' days')::INTERVAL;
                GET DIAGNOSTICS deleted_count = ROW_COUNT;
            WHEN 'tenant_access_monitoring' THEN
                DELETE FROM tenant_access_monitoring 
                WHERE created_at < CURRENT_TIMESTAMP - (policy.retention_days || ' days')::INTERVAL;
                GET DIAGNOSTICS deleted_count = ROW_COUNT;
            WHEN 'security_events' THEN
                DELETE FROM security_events 
                WHERE created_at < CURRENT_TIMESTAMP - (policy.retention_days || ' days')::INTERVAL
                AND resolved = TRUE;
                GET DIAGNOSTICS deleted_count = ROW_COUNT;
            ELSE
                deleted_count := 0;
        END CASE;
        
        UPDATE audit_retention_policies 
        SET last_cleanup_at = CURRENT_TIMESTAMP 
        WHERE id = policy.id;
        
        RETURN QUERY SELECT policy.table_name, deleted_count;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 10. INITIAL DATA
-- ============================================================================

-- Set default rate limit tiers for existing organizations
INSERT INTO organization_rate_limits (organization_id, tier, requests_per_minute, requests_per_hour, requests_per_day)
SELECT id, 'standard', 60, 1000, 10000
FROM organizations
ON CONFLICT (organization_id) DO NOTHING;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE request_audit_logs IS 'Comprehensive audit trail of all API requests';
COMMENT ON TABLE critical_operations_audit IS 'Audit log for high-risk operations requiring special tracking';
COMMENT ON TABLE rate_limit_tracking IS 'Track rate limit usage patterns and violations';
COMMENT ON TABLE rate_limit_bypass_credentials IS 'Credentials for bypassing rate limits (integrations, high-priority)';
COMMENT ON TABLE tenant_access_monitoring IS 'Monitor cross-tenant access for security analysis';
COMMENT ON TABLE security_events IS 'Log security-relevant events for threat detection and response';
COMMENT ON TABLE organization_rate_limits IS 'Organization-specific rate limit configurations';
COMMENT ON TABLE audit_retention_policies IS 'Define data retention policies for audit tables';

-- ============================================================================
-- PERMISSIONS
-- ============================================================================

-- Grant appropriate permissions (adjust based on your roles)
-- GRANT SELECT, INSERT ON request_audit_logs TO backend_service;
-- GRANT SELECT, INSERT ON critical_operations_audit TO backend_service;
-- GRANT SELECT, INSERT, UPDATE ON rate_limit_tracking TO backend_service;

COMMENT ON FUNCTION cleanup_old_audit_logs() IS 'Cleanup old audit logs based on retention policies';
