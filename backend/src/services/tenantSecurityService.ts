import { pool } from '../config/database.js';
import logger from '../utils/logger.js';

export interface TenantSecurityEvent {
  organizationId: number;
  eventType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  sourceUserId?: number;
  targetOrganizationId?: number;
  resourceType?: string;
  resourceId?: string;
  description: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
}

export interface TenantAccessPattern {
  organizationId: number;
  patternType: string;
  patternValue: Record<string, any>;
  confidenceScore: number;
}

export interface TenantSecuritySummary {
  organizationId: number;
  unresolvedEvents: number;
  criticalEvents24h: number;
  uniqueIPsLastHour: number;
  recentEvents: TenantSecurityEvent[];
  anomalies: TenantAccessPattern[];
}

/**
 * Service for tenant security monitoring and event tracking
 */
export class TenantSecurityService {
  /**
   * Record a security event
   */
  async recordSecurityEvent(event: TenantSecurityEvent): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO tenant_security_events (
          organization_id, event_type, severity, source_user_id,
          target_organization_id, resource_type, resource_id,
          description, ip_address, user_agent, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)`,
        [
          event.organizationId,
          event.eventType,
          event.severity,
          event.sourceUserId || null,
          event.targetOrganizationId || null,
          event.resourceType || null,
          event.resourceId || null,
          event.description,
          event.ipAddress || null,
          event.userAgent || null,
          event.metadata ? JSON.stringify(event.metadata) : null,
        ]
      );

      logger.warn('Tenant security event recorded', {
        organizationId: event.organizationId,
        eventType: event.eventType,
        severity: event.severity,
      });
    } catch (error) {
      logger.error('Failed to record security event', { error, eventType: event.eventType });
    }
  }

  /**
   * Get security summary for an organization
   */
  async getSecuritySummary(organizationId: number): Promise<TenantSecuritySummary> {
    try {
      // Unresolved events count
      const unresolvedResult = await pool.query(
        `SELECT COUNT(*) as count
         FROM tenant_security_events
         WHERE organization_id = $1
         AND is_resolved = FALSE`,
        [organizationId]
      );

      // Critical events in last 24 hours
      const criticalResult = await pool.query(
        `SELECT COUNT(*) as count
         FROM tenant_security_events
         WHERE organization_id = $1
         AND severity = 'critical'
         AND created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'`,
        [organizationId]
      );

      // Unique IPs in last hour
      const ipsResult = await pool.query(
        `SELECT COUNT(DISTINCT ip_address) as count
         FROM tenant_access_logs
         WHERE tenant_id = $1
         AND created_at > CURRENT_TIMESTAMP - INTERVAL '1 hour'`,
        [organizationId]
      );

      // Recent events
      const recentResult = await pool.query(
        `SELECT *
         FROM tenant_security_events
         WHERE organization_id = $1
         ORDER BY created_at DESC
         LIMIT 10`,
        [organizationId]
      );

      // Anomalies
      const anomaliesResult = await pool.query(
        `SELECT *
         FROM tenant_access_patterns
         WHERE organization_id = $1
         AND is_anomaly = TRUE
         ORDER BY last_seen_at DESC
         LIMIT 5`,
        [organizationId]
      );

      return {
        organizationId,
        unresolvedEvents: parseInt(unresolvedResult.rows[0].count, 10),
        criticalEvents24h: parseInt(criticalResult.rows[0].count, 10),
        uniqueIPsLastHour: parseInt(ipsResult.rows[0].count, 10),
        recentEvents: recentResult.rows.map((row) => ({
          organizationId: row.organization_id,
          eventType: row.event_type,
          severity: row.severity,
          sourceUserId: row.source_user_id,
          targetOrganizationId: row.target_organization_id,
          resourceType: row.resource_type,
          resourceId: row.resource_id,
          description: row.description,
          ipAddress: row.ip_address,
          userAgent: row.user_agent,
          metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        })),
        anomalies: anomaliesResult.rows.map((row) => ({
          organizationId: row.organization_id,
          patternType: row.pattern_type,
          patternValue: JSON.parse(row.pattern_value),
          confidenceScore: parseFloat(row.confidence_score),
        })),
      };
    } catch (error) {
      logger.error('Failed to get security summary', { error, organizationId });
      return {
        organizationId,
        unresolvedEvents: 0,
        criticalEvents24h: 0,
        uniqueIPsLastHour: 0,
        recentEvents: [],
        anomalies: [],
      };
    }
  }

  /**
   * Resolve a security event
   */
  async resolveSecurityEvent(
    eventId: number,
    resolvedBy: number,
    resolutionNotes: string
  ): Promise<void> {
    try {
      await pool.query(
        `UPDATE tenant_security_events
         SET is_resolved = TRUE,
             resolved_at = CURRENT_TIMESTAMP,
             resolved_by = $1,
             resolution_notes = $2
         WHERE id = $3`,
        [resolvedBy, resolutionNotes, eventId]
      );

      logger.info('Security event resolved', { eventId, resolvedBy });
    } catch (error) {
      logger.error('Failed to resolve security event', { error, eventId });
    }
  }

  /**
   * Record access pattern for anomaly detection
   */
  async recordAccessPattern(pattern: TenantAccessPattern): Promise<void> {
    try {
      // Check if pattern already exists
      const existingResult = await pool.query(
        `SELECT id, occurrence_count, confidence_score
         FROM tenant_access_patterns
         WHERE organization_id = $1
         AND pattern_type = $2
         AND pattern_value = $3`,
        [pattern.organizationId, pattern.patternType, JSON.stringify(pattern.patternValue)]
      );

      if (existingResult.rows.length > 0) {
        // Update existing pattern
        const existing = existingResult.rows[0];
        const newCount = existing.occurrence_count + 1;
        const newConfidence = Math.min(1.0, pattern.confidenceScore * 0.5 + existing.confidence_score * 0.5);

        await pool.query(
          `UPDATE tenant_access_patterns
           SET occurrence_count = $1,
               confidence_score = $2,
               last_seen_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $3`,
          [newCount, newConfidence, existing.id]
        );
      } else {
        // Insert new pattern
        await pool.query(
          `INSERT INTO tenant_access_patterns (
            organization_id, pattern_type, pattern_value,
            confidence_score, first_seen_at, last_seen_at, created_at
          ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [
            pattern.organizationId,
            pattern.patternType,
            JSON.stringify(pattern.patternValue),
            pattern.confidenceScore,
          ]
        );
      }
    } catch (error) {
      logger.error('Failed to record access pattern', { error, patternType: pattern.patternType });
    }
  }

  /**
   * Detect anomalous access patterns
   */
  async detectAnomalies(organizationId: number): Promise<TenantAccessPattern[]> {
    try {
      // Detect multiple IPs per user
      const multiIpResult = await pool.query(
        `SELECT 
          user_id,
          COUNT(DISTINCT ip_address) as ip_count,
          ARRAY_AGG(DISTINCT ip_address) as ips
         FROM tenant_access_logs
         WHERE tenant_id = $1
         AND created_at > CURRENT_TIMESTAMP - INTERVAL '1 hour'
         AND user_id IS NOT NULL
         GROUP BY user_id
         HAVING COUNT(DISTINCT ip_address) > 3`,
        [organizationId]
      );

      const anomalies: TenantAccessPattern[] = [];

      for (const row of multiIpResult.rows) {
        const pattern: TenantAccessPattern = {
          organizationId,
          patternType: 'multiple_ips_per_user',
          patternValue: {
            userId: row.user_id,
            ipCount: row.ip_count,
            ips: row.ips,
          },
          confidenceScore: Math.min(1.0, row.ip_count / 10),
        };

        anomalies.push(pattern);
        await this.recordAccessPattern(pattern);
      }

      // Detect unusual access times
      const unusualTimeResult = await pool.query(
        `SELECT 
          user_id,
          EXTRACT(HOUR FROM created_at) as access_hour,
          COUNT(*) as count
         FROM tenant_access_logs
         WHERE tenant_id = $1
         AND created_at > CURRENT_TIMESTAMP - INTERVAL '7 days'
         AND user_id IS NOT NULL
         GROUP BY user_id, EXTRACT(HOUR FROM created_at)
         HAVING EXTRACT(HOUR FROM created_at) BETWEEN 0 AND 5
         AND COUNT(*) > 10`,
        [organizationId]
      );

      for (const row of unusualTimeResult.rows) {
        const pattern: TenantAccessPattern = {
          organizationId,
          patternType: 'unusual_access_time',
          patternValue: {
            userId: row.user_id,
            accessHour: row.access_hour,
            count: row.count,
          },
          confidenceScore: Math.min(1.0, row.count / 50),
        };

        anomalies.push(pattern);
        await this.recordAccessPattern(pattern);
      }

      return anomalies;
    } catch (error) {
      logger.error('Failed to detect anomalies', { error, organizationId });
      return [];
    }
  }

  /**
   * Get security events with filtering
   */
  async getSecurityEvents(
    organizationId: number,
    filters: {
      eventType?: string;
      severity?: string;
      isResolved?: boolean;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ events: TenantSecurityEvent[]; total: number }> {
    try {
      const conditions: string[] = ['organization_id = $1'];
      const values: any[] = [organizationId];
      let paramIdx = 2;

      if (filters.eventType) {
        conditions.push(`event_type = $${paramIdx++}`);
        values.push(filters.eventType);
      }

      if (filters.severity) {
        conditions.push(`severity = $${paramIdx++}`);
        values.push(filters.severity);
      }

      if (filters.isResolved !== undefined) {
        conditions.push(`is_resolved = $${paramIdx++}`);
        values.push(filters.isResolved);
      }

      if (filters.startDate) {
        conditions.push(`created_at >= $${paramIdx++}`);
        values.push(filters.startDate);
      }

      if (filters.endDate) {
        conditions.push(`created_at <= $${paramIdx++}`);
        values.push(filters.endDate);
      }

      const whereClause = `WHERE ${conditions.join(' AND ')}`;
      const limit = filters.limit || 50;
      const offset = filters.offset || 0;

      // Get total count
      const countResult = await pool.query(
        `SELECT COUNT(*) FROM tenant_security_events ${whereClause}`,
        values
      );
      const total = parseInt(countResult.rows[0].count, 10);

      // Get events
      const eventsResult = await pool.query(
        `SELECT * FROM tenant_security_events ${whereClause}
         ORDER BY created_at DESC
         LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
        [...values, limit, offset]
      );

      return {
        events: eventsResult.rows.map((row) => ({
          organizationId: row.organization_id,
          eventType: row.event_type,
          severity: row.severity,
          sourceUserId: row.source_user_id,
          targetOrganizationId: row.target_organization_id,
          resourceType: row.resource_type,
          resourceId: row.resource_id,
          description: row.description,
          ipAddress: row.ip_address,
          userAgent: row.user_agent,
          metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        })),
        total,
      };
    } catch (error) {
      logger.error('Failed to get security events', { error, organizationId });
      return { events: [], total: 0 };
    }
  }
}

export const tenantSecurityService = new TenantSecurityService();