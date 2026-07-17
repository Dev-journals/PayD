import express from 'express';
import { tenantSecurityService } from '../services/tenantSecurityService.js';
import authenticateJWT from '../middlewares/auth.js';
import { pool } from '../config/database.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * GET /api/tenant-security/summary/:organizationId
 * Get security summary for an organization
 */
router.get('/summary/:organizationId', authenticateJWT, async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId, 10);

    const summary = await tenantSecurityService.getSecuritySummary(organizationId);

    res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    logger.error('Failed to get security summary', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve security summary',
    });
  }
});

/**
 * GET /api/tenant-security/events/:organizationId
 * Get security events with filtering
 */
router.get('/events/:organizationId', authenticateJWT, async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId, 10);
    const {
      eventType,
      severity,
      isResolved,
      startDate,
      endDate,
      limit,
      offset,
    } = req.query;

    const filters: any = {};
    if (eventType) filters.eventType = eventType as string;
    if (severity) filters.severity = severity as string;
    if (isResolved !== undefined) filters.isResolved = isResolved === 'true';
    if (startDate) filters.startDate = new Date(startDate as string);
    if (endDate) filters.endDate = new Date(endDate as string);
    if (limit) filters.limit = parseInt(limit as string, 10);
    if (offset) filters.offset = parseInt(offset as string, 10);

    const result = await tenantSecurityService.getSecurityEvents(organizationId, filters);

    res.json({
      success: true,
      data: result.events,
      total: result.total,
    });
  } catch (error) {
    logger.error('Failed to get security events', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve security events',
    });
  }
});

/**
 * POST /api/tenant-security/events/:eventId/resolve
 * Resolve a security event
 */
router.post('/events/:eventId/resolve', authenticateJWT, async (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId, 10);
    const { resolutionNotes } = req.body;
    const resolvedBy = req.user?.id ? parseInt(req.user.id as string, 10) : undefined;

    if (!resolvedBy) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    if (!resolutionNotes) {
      return res.status(400).json({
        success: false,
        error: 'resolutionNotes is required',
      });
    }

    await tenantSecurityService.resolveSecurityEvent(eventId, resolvedBy, resolutionNotes);

    res.json({
      success: true,
      message: 'Security event resolved',
    });
  } catch (error) {
    logger.error('Failed to resolve security event', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to resolve security event',
    });
  }
});

/**
 * POST /api/tenant-security/detect-anomalies/:organizationId
 * Manually trigger anomaly detection
 */
router.post('/detect-anomalies/:organizationId', authenticateJWT, async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId, 10);

    const anomalies = await tenantSecurityService.detectAnomalies(organizationId);

    res.json({
      success: true,
      data: anomalies,
      count: anomalies.length,
    });
  } catch (error) {
    logger.error('Failed to detect anomalies', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to detect anomalies',
    });
  }
});

/**
 * GET /api/tenant-security/anomalies/:organizationId
 * Get detected anomalies for an organization
 */
router.get('/anomalies/:organizationId', authenticateJWT, async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId, 10);
    const limit = parseInt(req.query.limit as string, 10) || 20;

    const result = await pool.query(
      `SELECT *
       FROM tenant_access_patterns
       WHERE organization_id = $1
       AND is_anomaly = TRUE
       ORDER BY last_seen_at DESC
       LIMIT $2`,
      [organizationId, limit]
    );

    res.json({
      success: true,
      data: result.rows.map((row) => ({
        id: row.id,
        patternType: row.pattern_type,
        patternValue: JSON.parse(row.pattern_value),
        confidenceScore: parseFloat(row.confidence_score),
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
        occurrenceCount: row.occurrence_count,
      })),
    });
  } catch (error) {
    logger.error('Failed to get anomalies', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve anomalies',
    });
  }
});

/**
 * GET /api/tenant-security/organizations
 * Get all organizations with their security summary
 */
router.get('/organizations', authenticateJWT, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM v_tenant_security_summary
       ORDER BY critical_events_24h DESC, unresolved_events DESC`
    );

    res.json({
      success: true,
      data: result.rows.map((row) => ({
        organizationId: row.organization_id,
        organizationName: row.organization_name,
        unresolvedEvents: parseInt(row.unresolved_events, 10),
        criticalEvents24h: parseInt(row.critical_events_24h, 10),
        uniqueIPsLastHour: parseInt(row.unique_ips_last_hour, 10),
      })),
    });
  } catch (error) {
    logger.error('Failed to get organizations security summary', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve organizations security summary',
    });
  }
});

/**
 * GET /api/tenant-security/access-logs/:organizationId
 * Get recent access logs for an organization
 */
router.get('/access-logs/:organizationId', authenticateJWT, async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId, 10);
    const limit = parseInt(req.query.limit as string, 10) || 50;

    const result = await pool.query(
      `SELECT *
       FROM tenant_access_logs
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [organizationId, limit]
    );

    res.json({
      success: true,
      data: result.rows.map((row) => ({
        id: row.id,
        tenantId: row.tenant_id,
        userId: row.user_id,
        userEmail: row.user_email,
        userRole: row.user_role,
        method: row.method,
        path: row.path,
        ipAddress: row.ip_address,
        userAgent: row.user_agent,
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    logger.error('Failed to get access logs', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve access logs',
    });
  }
});

export default router;