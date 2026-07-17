-- Migration: Backend Robustness Enhancement - Part 45
-- Description: Enhanced auditing, rate limiting, and multi-tenant isolation
-- Author: Backend Team
-- Date: 2024-01-15

-- ============================================================================
-- 1. AUDIT ANALYTICS TABLE
-- ============================================================================
-- Aggregated audit data for analytics and reporting

CREATE TABLE IF NOT EXISTS audit_analytics (
    id BIGSERIAL PRIMARY KEY,
    organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    metric_type VARCHAR(100) NOT NULL,
    metric_value NUMERIC NOT NULL,
    dimension VARCHAR(100),
    dimension_value VARCHAR(255),
    period_start TIMESTAMP WITH TIME ZONE NOT NULL,
    period_end TIMESTAMP WITH TIME ZONE NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_analytics_org_id ON audit_analytics(organization_id);
CREATE INDEX idx_audit_analytics_metric_type ON audit_analytics(metric_type);
CREATE INDEX idx_audit_analytics_period ON audit_analytics(period_start, period_end);
CREATE INDEX idx_audit_analytics_dimension ON audit_analytics(dimension, dimension_value);

-- ============================================================================
-- 2. SMART RATE LIMIT CONFIGURATIONS
-- ============================================================================
-- Dynamic rate limit configurations based on organization behavior

CREATE TABLE IF NOT EXISTS smart_rate_limit_configs (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
    base_limit INTEGER NOT NULL DEFAULT 100,
    burst_limit INTEGER NOT NULL DEFAULT 200,
    cooldown_period_seconds INTEGER NOT NULL DEFAULT 300,
    adaptation_factor NUMERIC NOT NULL DEFAULT 1.0,
    behavior_score NUMERIC NOT NULL DEFAULT 100.0,
    last_violation_at TIMESTAMP WITH TIME ZONE,
    consecutive_violations INTEGER DEFAULT 0,
    is_restricted BOOLEAN DEFAULT FALSE,
    restricted_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_smart_rate_config_org_id ON smart_rate_limit_configs(organization_id);
CREATE INDEX idx_smart_rate_config_restricted ON smart_rate_limit_configs(is_restricted) WHERE is_restricted = TRUE;

-- ============================================================================
-- 3. TENANT SECURITY EVENTS
-- ============================================================================
-- Security events specific to multi-tenant isolation

CREATE TABLE IF NOT EXISTS tenant_security_events (
    id BIGSERIAL PRIMARY KEY,
    organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'medium',
    source_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    target_organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    resource_type VARCHAR(100),
    resource_id VARCHAR(255),
    description TEXT NOT NULL,
    ip_address INET,
    user_agent TEXT,
    metadata JSONB,
    is_resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    resolution_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tenant_security_org_id ON tenant_security_events(organization_id);
CREATE INDEX idx_tenant_security_type ON tenant_security_events(event_type);
CREATE INDEX idx_tenant_security_severity ON tenant_security_events(severity);
CREATE INDEX idx_tenant_security_unresolved ON tenant_security_events(is_resolved) WHERE is_resolved = FALSE;
CREATE INDEX idx_tenant_security_created_at ON tenant_security_events(created_at DESC);

-- ============================================================================
-- 4. AUDIT LOG AGGREGATION CACHE
-- ============================================================================
-- Cache for frequently accessed audit aggregations

CREATE TABLE IF NOT EXISTS audit_log_aggregation_cache (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    aggregation_type VARCHAR(100) NOT NULL,
    aggregation_key VARCHAR(255) NOT NULL,
    aggregation_value JSONB NOT NULL,
    computed_at TIMESTAMP WITH TIME ZONE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(organization_id, aggregation_type, aggregation_key)
);

CREATE INDEX idx_audit_cache_org_id ON audit_log_aggregation_cache(organization_id);
CREATE INDEX idx_audit_cache_expires ON audit_log_aggregation_cache(expires_at);
CREATE INDEX idx_audit_cache_type ON audit_log_aggregation_cache(aggregation_type);

-- ============================================================================
-- 5. RATE LIMIT RECOVERY LOG
-- ============================================================================
-- Track rate limit recovery and adaptation

CREATE TABLE IF NOT EXISTS rate_limit_recovery_log (
    id BIGSERIAL PRIMARY KEY,
    organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    previous_limit INTEGER NOT NULL,
    new_limit INTEGER NOT NULL,
    reason VARCHAR(255) NOT NULL,
    behavior_score_before NUMERIC,
    behavior_score_after NUMERIC,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_rate_recovery_org_id ON rate_limit_recovery_log(organization_id);
CREATE INDEX idx_rate_recovery_created_at ON rate_limit_recovery_log(created_at DESC);

-- ============================================================================
-- 6. TENANT ACCESS PATTERNS
-- ============================================================================
-- Aggregated tenant access patterns for anomaly detection

CREATE TABLE IF NOT EXISTS tenant_access_patterns (
    id BIGSERIAL PRIMARY KEY,
    organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    pattern_type VARCHAR(100) NOT NULL,
    pattern_value JSONB NOT NULL,
    confidence_score NUMERIC NOT NULL DEFAULT 0.0,
    first_seen_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL,
    occurrence_count INTEGER DEFAULT 1,
    is_anomaly BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_access_patterns_org_id ON tenant_access_patterns(organization_id);
CREATE INDEX idx_access_patterns_type ON tenant_access_patterns(pattern_type);
CREATE INDEX idx_access_patterns_anomaly ON tenant_access_patterns(is_anomaly) WHERE is_anomaly = TRUE;

-- ============================================================================
-- 7. FUNCTIONS AND TRIGGERS
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
CREATE TRIGGER update_smart_rate_limit_configs_updated_at
    BEFORE UPDATE ON smart_rate_limit_configs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tenant_access_patterns_updated_at
    BEFORE UPDATE ON tenant_access_patterns
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to calculate behavior score based on rate limit violations
CREATE OR REPLACE FUNCTION calculate_behavior_score(org_id INTEGER)
RETURNS NUMERIC AS $$
DECLARE
    violation_count INTEGER;
    total_requests NUMERIC;
    behavior_score NUMERIC;
BEGIN
    -- Get violation count in last 24 hours
    SELECT COUNT(*) INTO violation_count
    FROM rate_limit_violations
    WHERE organization_id = org_id
    AND created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours';
    
    -- Get total requests in last 24 hours
    SELECT COUNT(*) INTO total_requests
    FROM api_audit_logs
    WHERE organization_id = org_id
    AND created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours';
    
    -- Calculate behavior score (0-100, higher is better)
    IF total_requests = 0 THEN
        behavior_score := 100.0;
    ELSE
        behavior_score := GREATEST(0, 100.0 - (violation_count * 10.0));
    END IF;
    
    RETURN behavior_score;
END;
$$ LANGUAGE plpgsql;

-- Function to automatically restrict organizations with poor behavior
CREATE OR REPLACE FUNCTION check_and_restrict_organization()
RETURNS TRIGGER AS $$
DECLARE
    behavior_score NUMERIC;
BEGIN
    behavior_score := calculate_behavior_score(NEW.organization_id);
    
    UPDATE smart_rate_limit_configs
    SET behavior_score = behavior_score,
        is_restricted = (behavior_score < 20),
        restricted_until = CASE 
            WHEN behavior_score < 20 THEN CURRENT_TIMESTAMP + INTERVAL '1 hour'
            ELSE NULL
        END,
        consecutive_violations = CASE
            WHEN behavior_score < 50 THEN consecutive_violations + 1
            ELSE 0
        END,
        updated_at = CURRENT_TIMESTAMP
    WHERE organization_id = NEW.organization_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to check behavior on rate limit violations
CREATE TRIGGER check_behavior_on_violation
    AFTER INSERT ON rate_limit_violations
    FOR EACH ROW
    EXECUTE FUNCTION check_and_restrict_organization();

-- ============================================================================
-- 8. VIEWS FOR ANALYTICS
-- ============================================================================

-- View for real-time rate limit status
CREATE OR REPLACE VIEW v_organization_rate_status AS
SELECT 
    o.id as organization_id,
    o.name as organization_name,
    COALESCE(srlc.base_limit, 100) as base_limit,
    COALESCE(srlc.behavior_score, 100) as behavior_score,
    COALESCE(srlc.is_restricted, FALSE) as is_restricted,
    srlc.restricted_until,
    (SELECT COUNT(*) 
     FROM rate_limit_violations rlv 
     WHERE rlv.organization_id = o.id 
     AND rlv.created_at > CURRENT_TIMESTAMP - INTERVAL '1 hour') as violations_last_hour,
    (SELECT COUNT(*) 
     FROM api_audit_logs aal 
     WHERE aal.organization_id = o.id 
     AND aal.created_at > CURRENT_TIMESTAMP - INTERVAL '1 hour') as requests_last_hour
FROM organizations o
LEFT JOIN smart_rate_limit_configs srlc ON o.id = srlc.organization_id;

-- View for tenant security summary
CREATE OR REPLACE VIEW v_tenant_security_summary AS
SELECT 
    o.id as organization_id,
    o.name as organization_name,
    (SELECT COUNT(*) 
     FROM tenant_security_events tse 
     WHERE tse.organization_id = o.id 
     AND tse.is_resolved = FALSE) as unresolved_events,
    (SELECT COUNT(*) 
     FROM tenant_security_events tse 
     WHERE tse.organization_id = o.id 
     AND tse.severity = 'critical'
     AND tse.created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours') as critical_events_24h,
    (SELECT COUNT(DISTINCT ip_address) 
     FROM tenant_access_logs tal 
     WHERE tal.tenant_id = o.id 
     AND tal.created_at > CURRENT_TIMESTAMP - INTERVAL '1 hour') as unique_ips_last_hour
FROM organizations o;

-- ============================================================================
-- 9. INITIAL DATA
-- ============================================================================

-- Initialize smart rate limit configs for existing organizations
INSERT INTO smart_rate_limit_configs (organization_id, base_limit, burst_limit, behavior_score)
SELECT id, 100, 200, 100.0
FROM organizations
ON CONFLICT (organization_id) DO NOTHING;

-- ============================================================================
-- 10. PERMISSIONS
-- ============================================================================

-- Grant appropriate permissions (adjust based on your roles)
-- GRANT SELECT, INSERT, UPDATE ON audit_analytics TO backend_service;
-- GRANT SELECT, INSERT, UPDATE ON smart_rate_limit_configs TO backend_service;
-- GRANT SELECT, INSERT ON tenant_security_events TO backend_service;
-- GRANT SELECT, INSERT ON audit_log_aggregation_cache TO backend_service;
-- GRANT SELECT, INSERT ON rate_limit_recovery_log TO backend_service;
-- GRANT SELECT, INSERT, UPDATE ON tenant_access_patterns TO backend_service;

-- ============================================================================
-- 11. COMMENTS
-- ============================================================================

COMMENT ON TABLE audit_analytics IS 'Aggregated audit data for analytics and reporting';
COMMENT ON TABLE smart_rate_limit_configs IS 'Dynamic rate limit configurations based on organization behavior';
COMMENT ON TABLE tenant_security_events IS 'Security events specific to multi-tenant isolation';
COMMENT ON TABLE audit_log_aggregation_cache IS 'Cache for frequently accessed audit aggregations';
COMMENT ON TABLE rate_limit_recovery_log IS 'Track rate limit recovery and adaptation';
COMMENT ON TABLE tenant_access_patterns IS 'Aggregated tenant access patterns for anomaly detection';
COMMENT ON FUNCTION calculate_behavior_score(INTEGER) IS 'Calculate behavior score based on rate limit violations';
COMMENT ON FUNCTION check_and_restrict_organization() IS 'Automatically restrict organizations with poor behavior';
COMMENT ON VIEW v_organization_rate_status IS 'Real-time rate limit status for organizations';
COMMENT ON VIEW v_tenant_security_summary IS 'Security summary for tenant organizations';