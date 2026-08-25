import express from 'express';
import { smartRateLimitService } from '../services/smartRateLimitService.js';
import authenticateJWT from '../middlewares/auth.js';
import { pool } from '../config/database.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * GET /api/smart-rate-limit/status/:organizationId
 * Get rate limit status for an organization
 */
router.get('/status/:organizationId', authenticateJWT, async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId, 10);

    const config = await smartRateLimitService.getConfig(organizationId);
    const decision = await smartRateLimitService.checkRateLimit(organizationId);

    res.json({
      success: true,
      data: {
        config,
        currentStatus: {
          allowed: decision.allowed,
          currentLimit: decision.currentLimit,
          remaining: decision.remaining,
          resetAt: decision.resetAt,
          behaviorScore: decision.behaviorScore,
          isRestricted: decision.isRestricted,
        },
      },
    });
  } catch (error) {
    logger.error('Failed to get rate limit status', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve rate limit status',
    });
  }
});

/**
 * GET /api/smart-rate-limit/history/:organizationId
 * Get rate limit recovery history
 */
router.get('/history/:organizationId', authenticateJWT, async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId, 10);
    const limit = parseInt(req.query.limit as string, 10) || 10;

    const history = await smartRateLimitService.getRecoveryHistory(organizationId, limit);

    res.json({
      success: true,
      data: history,
    });
  } catch (error) {
    logger.error('Failed to get rate limit history', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve rate limit history',
    });
  }
});

/**
 * GET /api/smart-rate-limit/violations/:organizationId
 * Get rate limit violations
 */
router.get('/violations/:organizationId', authenticateJWT, async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId, 10);
    const limit = parseInt(req.query.limit as string, 10) || 20;

    const result = await pool.query(
      `SELECT 
        identifier,
        tier,
        path,
        method,
        ip_address,
        created_at
       FROM rate_limit_violations
       WHERE organization_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [organizationId, limit]
    );

    res.json({
      success: true,
      data: result.rows.map((row) => ({
        identifier: row.identifier,
        tier: row.tier,
        path: row.path,
        method: row.method,
        ipAddress: row.ip_address,
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    logger.error('Failed to get rate limit violations', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve rate limit violations',
    });
  }
});

/**
 * POST /api/smart-rate-limit/update-score/:organizationId
 * Update behavior score for an organization
 */
router.post('/update-score/:organizationId', authenticateJWT, async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId, 10);
    const { scoreDelta } = req.body;

    if (scoreDelta === undefined) {
      return res.status(400).json({
        success: false,
        error: 'scoreDelta is required',
      });
    }

    await smartRateLimitService.updateBehaviorScore(organizationId, scoreDelta);

    const config = await smartRateLimitService.getConfig(organizationId);

    res.json({
      success: true,
      data: {
        organizationId,
        newBehaviorScore: config.behaviorScore,
      },
    });
  } catch (error) {
    logger.error('Failed to update behavior score', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to update behavior score',
    });
  }
});

/**
 * POST /api/smart-rate-limit/restrict/:organizationId
 * Manually restrict an organization
 */
router.post('/restrict/:organizationId', authenticateJWT, async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId, 10);
    const { reason, durationMinutes } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        error: 'reason is required',
      });
    }

    const config = await smartRateLimitService.getConfig(organizationId);
    const restrictedUntil = new Date(Date.now() + (durationMinutes || 60) * 60 * 1000);

    await pool.query(
      `UPDATE smart_rate_limit_configs
       SET is_restricted = TRUE,
           restricted_until = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE organization_id = $2`,
      [restrictedUntil, organizationId]
    );

    // Log the restriction
    await pool.query(
      `INSERT INTO rate_limit_recovery_log (
        organization_id, previous_limit, new_limit, reason,
        behavior_score_before, behavior_score_after, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
      [organizationId, config.baseLimit, 0, reason, config.behaviorScore, config.behaviorScore]
    );

    res.json({
      success: true,
      message: 'Organization restricted',
      data: {
        organizationId,
        restrictedUntil,
        reason,
      },
    });
  } catch (error) {
    logger.error('Failed to restrict organization', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to restrict organization',
    });
  }
});

/**
 * POST /api/smart-rate-limit/unrestrict/:organizationId
 * Remove restriction from an organization
 */
router.post('/unrestrict/:organizationId', authenticateJWT, async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId, 10);

    await pool.query(
      `UPDATE smart_rate_limit_configs
       SET is_restricted = FALSE,
           restricted_until = NULL,
           consecutive_violations = 0,
           updated_at = CURRENT_TIMESTAMP
       WHERE organization_id = $1`,
      [organizationId]
    );

    res.json({
      success: true,
      message: 'Organization unrestricted',
      data: { organizationId },
    });
  } catch (error) {
    logger.error('Failed to unrestrict organization', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to unrestrict organization',
    });
  }
});

/**
 * GET /api/smart-rate-limit/organizations
 * Get all organizations with their rate limit status
 */
router.get('/organizations', authenticateJWT, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM v_organization_rate_status
       ORDER BY behavior_score DESC`
    );

    res.json({
      success: true,
      data: result.rows.map((row) => ({
        organizationId: row.organization_id,
        organizationName: row.organization_name,
        baseLimit: row.base_limit,
        behaviorScore: parseFloat(row.behavior_score),
        isRestricted: row.is_restricted,
        restrictedUntil: row.restricted_until,
        violationsLastHour: parseInt(row.violations_last_hour, 10),
        requestsLastHour: parseInt(row.requests_last_hour, 10),
      })),
    });
  } catch (error) {
    logger.error('Failed to get organizations rate status', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve organizations rate status',
    });
  }
});

export default router;