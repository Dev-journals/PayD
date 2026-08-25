import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import pool from '../db/index.js';
import logger from '../utils/logger.js';

/**
 * Rate limit tier configurations
 */
export interface RateLimitTier {
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  burstAllowance: number;
}

/**
 * Predefined rate limit tiers
 */
export const RATE_LIMIT_TIERS: Record<string, RateLimitTier> = {
  free: {
    requestsPerMinute: 10,
    requestsPerHour: 100,
    requestsPerDay: 1000,
    burstAllowance: 5,
  },
  standard: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
    requestsPerDay: 10000,
    burstAllowance: 10,
  },
  premium: {
    requestsPerMinute: 200,
    requestsPerHour: 5000,
    requestsPerDay: 50000,
    burstAllowance: 50,
  },
  enterprise: {
    requestsPerMinute: 1000,
    requestsPerHour: 20000,
    requestsPerDay: 200000,
    burstAllowance: 200,
  },
};

/**
 * In-memory rate limit tracking
 * Format: Map<key, { count: number, windowStart: number, violations: number }>
 */
const rateLimitStore = new Map<
  string,
  { count: number; windowStart: number; violations: number; burst: number }
>();

/**
 * Clean up old entries from rate limit store
 */
setInterval(() => {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;

  for (const [key, value] of rateLimitStore.entries()) {
    if (value.windowStart < oneHourAgo) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000); // Clean up every 5 minutes

/**
 * Extract organization ID from request
 */
function getOrganizationId(req: Request): number | null {
  if (req.user && 'organizationId' in req.user) {
    return (req.user as any).organizationId;
  }

  if ('organizationId' in req) {
    return (req as any).organizationId;
  }

  if (req.query.organizationId) {
    return parseInt(req.query.organizationId as string, 10);
  }

  if (req.params.organizationId) {
    return parseInt(req.params.organizationId, 10);
  }

  return null;
}

/**
 * Get client IP address
 */
function getClientIp(req: Request): string {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    (req.headers['x-real-ip'] as string) ||
    req.socket.remoteAddress ||
    'unknown'
  );
}

/**
 * Check if bypass token is valid
 */
async function checkBypassToken(token: string, organizationId: number | null): Promise<boolean> {
  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const result = await pool.query(
      `SELECT id, organization_id, max_requests, requests_used, valid_until, is_active
       FROM rate_limit_bypass_credentials
       WHERE token_hash = $1 AND is_active = TRUE`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      return false;
    }

    const credential = result.rows[0];

    // Check if expired
    if (credential.valid_until && new Date(credential.valid_until) < new Date()) {
      return false;
    }

    // Check if organization matches (if specified)
    if (organizationId && credential.organization_id !== organizationId) {
      return false;
    }

    // Check if request limit exceeded
    if (credential.max_requests !== null && credential.requests_used >= credential.max_requests) {
      return false;
    }

    // Increment usage counter
    await pool.query(
      `UPDATE rate_limit_bypass_credentials
       SET requests_used = requests_used + 1, last_used_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [credential.id]
    );

    return true;
  } catch (error) {
    logger.error('Error checking bypass token:', error);
    return false;
  }
}

/**
 * Get rate limit configuration for organization
 */
async function getOrganizationRateLimit(organizationId: number): Promise<RateLimitTier> {
  try {
    const result = await pool.query(
      `SELECT tier, requests_per_minute, requests_per_hour, requests_per_day, burst_allowance
       FROM organization_rate_limits
       WHERE organization_id = $1`,
      [organizationId]
    );

    if (result.rows.length > 0) {
      const config = result.rows[0];
      return {
        requestsPerMinute: config.requests_per_minute,
        requestsPerHour: config.requests_per_hour,
        requestsPerDay: config.requests_per_day,
        burstAllowance: config.burst_allowance,
      };
    }

    // Default to standard tier
    return RATE_LIMIT_TIERS.standard;
  } catch (error) {
    logger.error('Error fetching organization rate limit:', error);
    return RATE_LIMIT_TIERS.standard;
  }
}

/**
 * Record rate limit tracking to database (async, non-blocking)
 */
async function recordRateLimitTracking(
  organizationId: number | null,
  ipAddress: string,
  endpointPattern: string,
  tier: string,
  requestsCount: number,
  windowStart: Date,
  windowEnd: Date,
  limitReached: boolean,
  violationsCount: number
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO rate_limit_tracking (
        organization_id, ip_address, endpoint_pattern, rate_limit_tier,
        requests_count, window_start, window_end, limit_reached, violations_count
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (organization_id, ip_address, endpoint_pattern, window_start)
      DO UPDATE SET
        requests_count = $5,
        limit_reached = $8,
        violations_count = $9,
        updated_at = CURRENT_TIMESTAMP`,
      [
        organizationId,
        ipAddress,
        endpointPattern,
        tier,
        requestsCount,
        windowStart,
        windowEnd,
        limitReached,
        violationsCount,
      ]
    );
  } catch (error) {
    logger.error('Failed to record rate limit tracking:', error);
  }
}

/**
 * Check rate limit for a given key and window
 */
function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  burstAllowance: number = 0
): { allowed: boolean; current: number; limit: number; resetAt: number; violations: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now - entry.windowStart > windowMs) {
    // New window or expired entry
    rateLimitStore.set(key, {
      count: 1,
      windowStart: now,
      violations: 0,
      burst: 0,
    });

    return {
      allowed: true,
      current: 1,
      limit,
      resetAt: now + windowMs,
      violations: 0,
    };
  }

  // Check if within burst allowance
  const effectiveLimit = limit + burstAllowance;

  if (entry.count < effectiveLimit) {
    entry.count++;
    if (entry.count > limit) {
      entry.burst++;
    }
    rateLimitStore.set(key, entry);

    return {
      allowed: true,
      current: entry.count,
      limit,
      resetAt: entry.windowStart + windowMs,
      violations: entry.violations,
    };
  }

  // Rate limit exceeded
  entry.violations++;
  rateLimitStore.set(key, entry);

  return {
    allowed: false,
    current: entry.count,
    limit,
    resetAt: entry.windowStart + windowMs,
    violations: entry.violations,
  };
}

/**
 * Middleware for organization-based rate limiting
 * 
 * Features:
 * - Organization-tier based limits (free, standard, premium, enterprise)
 * - Bypass token support for integrations
 * - Multi-window rate limiting (per minute, hour, day)
 * - Burst allowance for short spikes
 * - Violation tracking
 * - Database logging of rate limit events
 * 
 * @param options Configuration options
 * @returns Express middleware
 */
export function organizationRateLimiter(
  options: {
    defaultTier?: string;
    enableBypassTokens?: boolean;
    endpointPattern?: string;
  } = {}
): (req: Request, res: Response, next: NextFunction) => void {
  const { defaultTier = 'standard', enableBypassTokens = true, endpointPattern = 'general' } =
    options;

  return async (req: Request, res: Response, next: NextFunction) => {
    const organizationId = getOrganizationId(req);
    const ipAddress = getClientIp(req);

    // Check for bypass token
    if (enableBypassTokens) {
      const bypassToken =
        req.headers['x-ratelimit-bypass'] || req.headers['x-bypass-token'] || req.query.bypassToken;

      if (bypassToken && typeof bypassToken === 'string') {
        const isValid = await checkBypassToken(bypassToken, organizationId);
        if (isValid) {
          logger.debug('Rate limit bypassed with valid token', { organizationId, ipAddress });
          return next();
        }
      }
    }

    // Get rate limit configuration
    let rateLimitConfig: RateLimitTier;
    let tierName = defaultTier;

    if (organizationId) {
      rateLimitConfig = await getOrganizationRateLimit(organizationId);
      tierName = 'custom';
    } else {
      rateLimitConfig = RATE_LIMIT_TIERS[defaultTier] || RATE_LIMIT_TIERS.standard;
    }

    // Create rate limit keys
    const baseKey = organizationId ? `org:${organizationId}` : `ip:${ipAddress}`;
    const minuteKey = `${baseKey}:${endpointPattern}:minute`;
    const hourKey = `${baseKey}:${endpointPattern}:hour`;
    const dayKey = `${baseKey}:${endpointPattern}:day`;

    // Check all windows
    const minuteCheck = checkRateLimit(
      minuteKey,
      rateLimitConfig.requestsPerMinute,
      60 * 1000,
      rateLimitConfig.burstAllowance
    );

    const hourCheck = checkRateLimit(
      hourKey,
      rateLimitConfig.requestsPerHour,
      60 * 60 * 1000,
      rateLimitConfig.burstAllowance
    );

    const dayCheck = checkRateLimit(
      dayKey,
      rateLimitConfig.requestsPerDay,
      24 * 60 * 60 * 1000,
      rateLimitConfig.burstAllowance
    );

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit-Minute', rateLimitConfig.requestsPerMinute);
    res.setHeader('X-RateLimit-Remaining-Minute', Math.max(0, minuteCheck.limit - minuteCheck.current));
    res.setHeader('X-RateLimit-Reset-Minute', new Date(minuteCheck.resetAt).toISOString());

    res.setHeader('X-RateLimit-Limit-Hour', rateLimitConfig.requestsPerHour);
    res.setHeader('X-RateLimit-Remaining-Hour', Math.max(0, hourCheck.limit - hourCheck.current));

    res.setHeader('X-RateLimit-Limit-Day', rateLimitConfig.requestsPerDay);
    res.setHeader('X-RateLimit-Remaining-Day', Math.max(0, dayCheck.limit - dayCheck.current));

    // Check if any window is exceeded
    if (!minuteCheck.allowed || !hourCheck.allowed || !dayCheck.allowed) {
      const exceededWindow = !minuteCheck.allowed
        ? 'minute'
        : !hourCheck.allowed
          ? 'hour'
          : 'day';

      const resetAt = !minuteCheck.allowed
        ? minuteCheck.resetAt
        : !hourCheck.allowed
          ? hourCheck.resetAt
          : dayCheck.resetAt;

      // Log violation to database (async)
      recordRateLimitTracking(
        organizationId,
        ipAddress,
        endpointPattern,
        tierName,
        minuteCheck.current,
        new Date(minuteCheck.resetAt - 60000),
        new Date(minuteCheck.resetAt),
        true,
        minuteCheck.violations
      ).catch((err) => logger.error('Failed to record rate limit violation:', err));

      logger.warn('Rate limit exceeded', {
        organizationId,
        ipAddress,
        window: exceededWindow,
        tier: tierName,
        violations: minuteCheck.violations,
      });

      res.setHeader('Retry-After', Math.ceil((resetAt - Date.now()) / 1000));

      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: `Too many requests. Rate limit exceeded for ${exceededWindow} window.`,
        retryAfter: new Date(resetAt).toISOString(),
        limit: exceededWindow === 'minute' 
          ? minuteCheck.limit 
          : exceededWindow === 'hour' 
            ? hourCheck.limit 
            : dayCheck.limit,
        current: exceededWindow === 'minute' 
          ? minuteCheck.current 
          : exceededWindow === 'hour' 
            ? hourCheck.current 
            : dayCheck.current,
      });
    }

    // Periodically log rate limit tracking (every 100 requests or so)
    if (minuteCheck.current % 100 === 0) {
      recordRateLimitTracking(
        organizationId,
        ipAddress,
        endpointPattern,
        tierName,
        minuteCheck.current,
        new Date(minuteCheck.resetAt - 60000),
        new Date(minuteCheck.resetAt),
        false,
        0
      ).catch((err) => logger.error('Failed to record rate limit tracking:', err));
    }

    next();
  };
}

/**
 * Generate a bypass token for an organization
 */
export async function generateBypassToken(
  organizationId: number,
  description: string,
  validUntil: Date | null = null,
  maxRequests: number | null = null,
  createdBy: number | null = null
): Promise<string> {
  // Generate a secure random token
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const tokenPrefix = token.substring(0, 8);

  await pool.query(
    `INSERT INTO rate_limit_bypass_credentials (
      organization_id, token_hash, token_prefix, description,
      max_requests, valid_until, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [organizationId, tokenHash, tokenPrefix, description, maxRequests, validUntil, createdBy]
  );

  logger.info('Generated rate limit bypass token', {
    organizationId,
    tokenPrefix,
    validUntil,
    maxRequests,
  });

  return token;
}

/**
 * Revoke a bypass token
 */
export async function revokeBypassToken(tokenPrefix: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE rate_limit_bypass_credentials
     SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
     WHERE token_prefix = $1`,
    [tokenPrefix]
  );

  return result.rowCount > 0;
}

/**
 * Get rate limit statistics for an organization
 */
export async function getRateLimitStats(
  organizationId: number,
  startDate: Date,
  endDate: Date
): Promise<any> {
  const result = await pool.query(
    `SELECT 
      COUNT(*) as total_windows,
      SUM(requests_count) as total_requests,
      SUM(violations_count) as total_violations,
      MAX(requests_count) as peak_requests,
      rate_limit_tier,
      endpoint_pattern
     FROM rate_limit_tracking
     WHERE organization_id = $1
       AND window_start >= $2
       AND window_end <= $3
     GROUP BY rate_limit_tier, endpoint_pattern
     ORDER BY total_requests DESC`,
    [organizationId, startDate, endDate]
  );

  return result.rows;
}

/**
 * Update organization rate limit tier
 */
export async function updateOrganizationTier(
  organizationId: number,
  tier: string
): Promise<void> {
  const tierConfig = RATE_LIMIT_TIERS[tier];
  if (!tierConfig) {
    throw new Error(`Invalid tier: ${tier}`);
  }

  await pool.query(
    `INSERT INTO organization_rate_limits (
      organization_id, tier, requests_per_minute, requests_per_hour,
      requests_per_day, burst_allowance
    ) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (organization_id)
    DO UPDATE SET
      tier = $2,
      requests_per_minute = $3,
      requests_per_hour = $4,
      requests_per_day = $5,
      burst_allowance = $6,
      updated_at = CURRENT_TIMESTAMP`,
    [
      organizationId,
      tier,
      tierConfig.requestsPerMinute,
      tierConfig.requestsPerHour,
      tierConfig.requestsPerDay,
      tierConfig.burstAllowance,
    ]
  );

  logger.info('Updated organization rate limit tier', { organizationId, tier });
}

export default organizationRateLimiter;
