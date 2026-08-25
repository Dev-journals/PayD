import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import os from 'os';
import { rateLimitService, RateLimitTierName } from '../services/rateLimitService.js';
import logger from '../utils/logger.js';
import { pool } from '../config/database.js';

export interface AdvancedRateLimitOptions {
  tier?: RateLimitTierName;
  identifier?: (req: Request) => string;
  skip?: (req: Request) => boolean;
  handler?: (req: Request, res: Response) => void;
  enableBypass?: boolean;
  bypassTokenHeader?: string;
  enableDynamicLimits?: boolean;
  organizationBased?: boolean;
}

interface RateLimitBypassToken {
  token: string;
  organizationId?: number;
  userId?: string;
  expiresAt: Date;
  requestsRemaining?: number;
}

/**
 * Advanced rate limiting with bypass tokens, dynamic limits, and organization-based throttling
 */
export function advancedRateLimitMiddleware(options: AdvancedRateLimitOptions = {}) {
  const {
    tier = 'api',
    identifier = defaultIdentifier,
    skip,
    handler,
    enableBypass = false,
    bypassTokenHeader = 'x-ratelimit-bypass',
    enableDynamicLimits = false,
    organizationBased = false,
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Check skip condition
    if (skip && skip(req)) {
      return next();
    }

    // Check for bypass token
    if (enableBypass) {
      const bypassToken = req.headers[bypassTokenHeader];
      if (bypassToken) {
        const bypassValid = await validateBypassToken(
          bypassToken as string,
          req.tenantId,
          req.user?.id
        );
        if (bypassValid) {
          logger.info('Rate limit bypassed with valid token', {
            organizationId: req.tenantId,
            userId: req.user?.id,
            path: req.path,
          });
          res.setHeader('X-RateLimit-Bypassed', 'true');
          return next();
        }
      }
    }

    // Determine identifier (IP, user, or organization)
    let clientIdentifier = identifier(req);

    // Use organization-based rate limiting if enabled
    if (organizationBased && req.tenantId) {
      clientIdentifier = `org:${req.tenantId}`;
    } else if (req.user?.id) {
      clientIdentifier = `user:${req.user.id}`;
    }

    // Get dynamic limits if enabled
    let effectiveTier = tier;
    if (enableDynamicLimits && req.tenantId) {
      const dynamicTier = await getDynamicRateLimit(req.tenantId, req.user?.id);
      if (dynamicTier) {
        effectiveTier = dynamicTier;
      }
    }

    try {
      const result = await rateLimitService.checkRateLimit(clientIdentifier, effectiveTier, req.tenantId);

      // Set standard rate limit headers
      res.setHeader('X-RateLimit-Limit', result.limit);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt.getTime() / 1000));
      res.setHeader('X-RateLimit-Tier', effectiveTier);

      if (!result.allowed) {
        res.setHeader('Retry-After', result.retryAfter || 60);

        // Log rate limit violation
        await logRateLimitViolation({
          identifier: clientIdentifier,
          tier: effectiveTier,
          organizationId: req.tenantId,
          userId: req.user?.id,
          path: req.path,
          method: req.method,
          ipAddress: extractIpAddress(req),
          userAgent: req.headers['user-agent'],
        });

        logger.warn('Rate limit exceeded', {
          identifier: clientIdentifier,
          tier: effectiveTier,
          path: req.path,
          method: req.method,
          organizationId: req.tenantId,
          userId: req.user?.id,
        });

        if (handler) {
          handler(req, res);
        } else {
          defaultRateLimitHandler(req, res, result);
        }
        return;
      }

      next();
    } catch (error) {
      logger.error('Advanced rate limit middleware error', { error, path: req.path });
      // Fail open - don't block requests on rate limiter errors
      next();
    }
  };
}

/**
 * Adaptive rate limiting that adjusts based on system load
 */
export function adaptiveRateLimitMiddleware(options: AdvancedRateLimitOptions = {}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const systemLoad = getSystemLoad();

    let adjustedTier: RateLimitTierName = options.tier || 'api';

    // Reduce limits under high load
    if (systemLoad > 0.9) {
      adjustedTier = 'strict';
      logger.warn('System under high load, applying strict rate limits', { systemLoad });
    } else if (systemLoad > 0.75) {
      adjustedTier = 'auth'; // More restrictive
    }

    return advancedRateLimitMiddleware({
      ...options,
      tier: adjustedTier,
    })(req, res, next);
  };
}

/**
 * Organization-tier based rate limiting
 * Premium organizations get higher limits
 */
export function tieredOrganizationRateLimit(options: Omit<AdvancedRateLimitOptions, 'tier'> = {}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    let tier: RateLimitTierName = 'api';

    if (req.tenantId) {
      const orgTier = await getOrganizationTier(req.tenantId);

      switch (orgTier) {
        case 'premium':
        case 'enterprise':
          tier = 'data'; // Higher limits
          break;
        case 'free':
        case 'trial':
          tier = 'strict'; // Lower limits
          break;
        default:
          tier = 'api';
      }
    }

    return advancedRateLimitMiddleware({
      ...options,
      tier,
      organizationBased: true,
    })(req, res, next);
  };
}

/**
 * Endpoint-specific rate limiting with custom rules
 */
export function endpointRateLimit(config: {
  [endpoint: string]: { tier: RateLimitTierName; methods?: string[] };
}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    for (const [pattern, rules] of Object.entries(config)) {
      const regex = new RegExp(pattern);
      if (regex.test(req.path)) {
        // Check if method matches if specified
        if (rules.methods && !rules.methods.includes(req.method)) {
          continue;
        }

        return advancedRateLimitMiddleware({ tier: rules.tier })(req, res, next);
      }
    }

    // Default rate limit if no pattern matches
    return advancedRateLimitMiddleware()(req, res, next);
  };
}

/**
 * Generate a bypass token for high-priority operations
 */
export async function generateBypassToken(
  organizationId?: number,
  userId?: string,
  validForMinutes: number = 60,
  maxRequests?: number
): Promise<string> {
  const token = generateSecureToken();
  const expiresAt = new Date(Date.now() + validForMinutes * 60 * 1000);

  try {
    await pool.query(
      `INSERT INTO rate_limit_bypass_tokens (
        token, organization_id, user_id, expires_at, requests_remaining, created_at
      ) VALUES ($1, $2, $3, $4, $5, NOW())`,
      [token, organizationId || null, userId || null, expiresAt, maxRequests || null]
    );

    logger.info('Rate limit bypass token generated', {
      organizationId,
      userId,
      validForMinutes,
      maxRequests,
    });

    return token;
  } catch (error) {
    logger.error('Failed to generate bypass token', { error });
    throw new Error('Failed to generate bypass token');
  }
}

/**
 * Validate a bypass token
 */
async function validateBypassToken(
  token: string,
  organizationId?: number,
  userId?: string
): Promise<boolean> {
  try {
    const result = await pool.query(
      `SELECT * FROM rate_limit_bypass_tokens 
       WHERE token = $1 AND expires_at > NOW() AND revoked = false`,
      [token]
    );

    if (result.rows.length === 0) {
      return false;
    }

    const tokenData = result.rows[0];

    // Validate organization and user match if specified in token
    if (tokenData.organization_id && tokenData.organization_id !== organizationId) {
      return false;
    }

    if (tokenData.user_id && tokenData.user_id !== userId) {
      return false;
    }

    // Check if request limit is exhausted
    if (tokenData.requests_remaining !== null) {
      if (tokenData.requests_remaining <= 0) {
        return false;
      }

      // Decrement requests remaining
      await pool.query(
        `UPDATE rate_limit_bypass_tokens 
         SET requests_remaining = requests_remaining - 1 
         WHERE token = $1`,
        [token]
      );
    }

    return true;
  } catch (error) {
    logger.error('Error validating bypass token', { error });
    return false;
  }
}

/**
 * Get dynamic rate limit tier for organization
 */
async function getDynamicRateLimit(
  organizationId: number,
  userId?: string
): Promise<RateLimitTierName | null> {
  try {
    const result = await pool.query(
      `SELECT rate_limit_tier FROM organization_settings 
       WHERE organization_id = $1`,
      [organizationId]
    );

    if (result.rows.length > 0 && result.rows[0].rate_limit_tier) {
      return result.rows[0].rate_limit_tier as RateLimitTierName;
    }

    return null;
  } catch (error) {
    logger.error('Error getting dynamic rate limit', { error, organizationId });
    return null;
  }
}

/**
 * Get organization tier (free, premium, enterprise, etc.)
 */
async function getOrganizationTier(organizationId: number): Promise<string> {
  try {
    const result = await pool.query(
      `SELECT subscription_tier FROM organizations WHERE id = $1`,
      [organizationId]
    );

    return result.rows[0]?.subscription_tier || 'free';
  } catch (error) {
    logger.error('Error getting organization tier', { error, organizationId });
    return 'free';
  }
}

/**
 * Log rate limit violations for analysis
 */
async function logRateLimitViolation(violation: {
  identifier: string;
  tier: RateLimitTierName;
  organizationId?: number;
  userId?: string;
  path: string;
  method: string;
  ipAddress: string;
  userAgent?: string;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO rate_limit_violations (
        identifier, tier, organization_id, user_id, path, method,
        ip_address, user_agent, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [
        violation.identifier,
        violation.tier,
        violation.organizationId || null,
        violation.userId || null,
        violation.path,
        violation.method,
        violation.ipAddress,
        violation.userAgent || null,
      ]
    );
  } catch (error) {
    logger.error('Failed to log rate limit violation', { error });
  }
}

/**
 * Get system load averaged across all CPUs (0.0–1.0 scale).
 * Uses OS-reported 1-minute load divided by CPU count for a
 * normalized metric that works across deployments.
 */
function getSystemLoad(): number {
  try {
    const cpus = os.cpus().length;
    const loadAvg = os.loadavg()[0]; // 1-minute load average
    return Math.min(loadAvg / cpus, 1.0);
  } catch {
    return 0.5; // safe fallback
  }
}

/**
 * Default rate limit handler
 */
function defaultRateLimitHandler(_req: Request, res: Response, result: any): void {
  res.status(429).json({
    error: 'Too Many Requests',
    message: 'Rate limit exceeded. Please try again later.',
    retryAfter: result.retryAfter,
    limit: result.limit,
    resetAt: result.resetAt,
  });
}

/**
 * Default identifier function
 */
function defaultIdentifier(req: Request): string {
  return (
    req.ip ||
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    (req.headers['x-real-ip'] as string) ||
    'unknown'
  );
}

/**
 * Extract IP address from request
 */
function extractIpAddress(req: Request): string {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    (req.headers['x-real-ip'] as string) ||
    req.ip ||
    'unknown'
  );
}

/**
 * Generate a secure random token
 */
function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Get rate limit statistics for an organization
 */
export async function getRateLimitStats(
  organizationId: number,
  startDate: Date,
  endDate: Date
): Promise<{
  totalViolations: number;
  violationsByTier: Record<string, number>;
  violationsByPath: Array<{ path: string; count: number }>;
  violationsByUser: Array<{ userId: string; count: number }>;
}> {
  const violationsResult = await pool.query(
    `SELECT COUNT(*) as total FROM rate_limit_violations 
     WHERE organization_id = $1 AND created_at BETWEEN $2 AND $3`,
    [organizationId, startDate, endDate]
  );

  const byTierResult = await pool.query(
    `SELECT tier, COUNT(*) as count FROM rate_limit_violations 
     WHERE organization_id = $1 AND created_at BETWEEN $2 AND $3
     GROUP BY tier`,
    [organizationId, startDate, endDate]
  );

  const byPathResult = await pool.query(
    `SELECT path, COUNT(*) as count FROM rate_limit_violations 
     WHERE organization_id = $1 AND created_at BETWEEN $2 AND $3
     GROUP BY path ORDER BY count DESC LIMIT 10`,
    [organizationId, startDate, endDate]
  );

  const byUserResult = await pool.query(
    `SELECT user_id, COUNT(*) as count FROM rate_limit_violations 
     WHERE organization_id = $1 AND created_at BETWEEN $2 AND $3 AND user_id IS NOT NULL
     GROUP BY user_id ORDER BY count DESC LIMIT 10`,
    [organizationId, startDate, endDate]
  );

  const violationsByTier: Record<string, number> = {};
  byTierResult.rows.forEach((row) => {
    violationsByTier[row.tier] = parseInt(row.count, 10);
  });

  return {
    totalViolations: parseInt(violationsResult.rows[0].total, 10),
    violationsByTier,
    violationsByPath: byPathResult.rows.map((row) => ({
      path: row.path,
      count: parseInt(row.count, 10),
    })),
    violationsByUser: byUserResult.rows.map((row) => ({
      userId: row.user_id,
      count: parseInt(row.count, 10),
    })),
  };
}
