import express from 'express';
import { auditAnalyticsService } from '../services/auditAnalyticsService.js';
import authenticateJWT from '../middlewares/auth.js';
import { pool } from '../config/database.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * GET /api/audit-analytics/summary/:organizationId
 * Get audit summary for an organization
 */
router.get('/summary/:organizationId', authenticateJWT, async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId, 10);
    const startDate = req.query.startDate
      ? new Date(req.query.startDate as string)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Last 7 days
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : new Date();

    const summary = await auditAnalyticsService.getAuditSummary(
      organizationId,
      startDate,
      endDate
    );

    res.json({
      success: true,
      data: summary,
      period: { startDate, endDate },
    });
  } catch (error) {
    logger.error('Failed to get audit summary', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve audit summary',
    });
  }
});

/**
 * GET /api/audit-analytics/trends/:organizationId
 * Get audit trends over time
 */
router.get('/trends/:organizationId', authenticateJWT, async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId, 10);
    const startDate = req.query.startDate
      ? new Date(req.query.startDate as string)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Last 30 days
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : new Date();
    const interval = (req.query.interval as 'hour' | 'day' | 'week') || 'day';

    const trends = await auditAnalyticsService.getAuditTrends(
      organizationId,
      startDate,
      endDate,
      interval
    );

    res.json({
      success: true,
      data: trends,
      period: { startDate, endDate, interval },
    });
  } catch (error) {
    logger.error('Failed to get audit trends', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve audit trends',
    });
  }
});

/**
 * GET /api/audit-analytics/endpoints/:organizationId
 * Get top endpoints by usage
 */
router.get('/endpoints/:organizationId', authenticateJWT, async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId, 10);
    const limit = parseInt(req.query.limit as string, 10) || 10;

    const result = await pool.query(
      `SELECT 
        path,
        method,
        COUNT(*) as request_count,
        AVG(duration_ms) as avg_duration,
        COUNT(CASE WHEN response_status >= 400 THEN 1 END) as error_count
       FROM api_audit_logs
       WHERE organization_id = $1
       AND created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
       GROUP BY path, method
       ORDER BY request_count DESC
       LIMIT $2`,
      [organizationId, limit]
    );

    res.json({
      success: true,
      data: result.rows.map((row) => ({
        path: row.path,
        method: row.method,
        requestCount: parseInt(row.request_count, 10),
        avgDuration: Math.round(row.avg_duration || 0),
        errorCount: parseInt(row.error_count, 10),
      })),
    });
  } catch (error) {
    logger.error('Failed to get top endpoints', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve top endpoints',
    });
  }
});

/**
 * GET /api/audit-analytics/errors/:organizationId
 * Get recent errors
 */
router.get('/errors/:organizationId', authenticateJWT, async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId, 10);
    const limit = parseInt(req.query.limit as string, 10) || 20;

    const result = await pool.query(
      `SELECT 
        path,
        method,
        response_status,
        error_message,
        COUNT(*) as occurrence_count,
        MAX(created_at) as last_occurred
       FROM api_audit_logs
       WHERE organization_id = $1
       AND response_status >= 400
       AND created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
       GROUP BY path, method, response_status, error_message
       ORDER BY occurrence_count DESC
       LIMIT $2`,
      [organizationId, limit]
    );

    res.json({
      success: true,
      data: result.rows.map((row) => ({
        path: row.path,
        method: row.method,
        statusCode: row.response_status,
        errorMessage: row.error_message,
        occurrenceCount: parseInt(row.occurrence_count, 10),
        lastOccurred: row.last_occurred,
      })),
    });
  } catch (error) {
    logger.error('Failed to get recent errors', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve recent errors',
    });
  }
});

/**
 * POST /api/audit-analytics/record
 * Record a custom analytics metric
 */
router.post('/record', authenticateJWT, async (req, res) => {
  try {
    const { metricType, metricValue, dimension, dimensionValue, metadata } = req.body;

    if (!metricType || metricValue === undefined) {
      return res.status(400).json({
        success: false,
        error: 'metricType and metricValue are required',
      });
    }

    await auditAnalyticsService.recordMetric({
      metricType,
      metricValue,
      dimension,
      dimensionValue,
      periodStart: new Date(),
      periodEnd: new Date(),
      metadata: {
        ...metadata,
        organizationId: req.user?.organizationId,
        userId: req.user?.id,
      },
    });

    res.json({
      success: true,
      message: 'Metric recorded successfully',
    });
  } catch (error) {
    logger.error('Failed to record metric', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to record metric',
    });
  }
});

/**
 * DELETE /api/audit-analytics/cache/:organizationId
 * Clear audit cache for an organization
 */
router.delete('/cache/:organizationId', authenticateJWT, async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId, 10);

    const result = await pool.query(
      `DELETE FROM audit_log_aggregation_cache
       WHERE organization_id = $1`,
      [organizationId]
    );

    res.json({
      success: true,
      message: `Cleared ${result.rowCount} cache entries`,
    });
  } catch (error) {
    logger.error('Failed to clear audit cache', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to clear audit cache',
    });
  }
});

export default router;