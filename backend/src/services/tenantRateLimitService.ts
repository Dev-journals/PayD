import { Redis } from 'ioredis';
import { pool } from '../config/database.js';
import logger from '../utils/logger.js';
import { RateLimitTierName } from './rateLimitService.js';

export interface TenantRateLimitOverride {
  windowMs: number;
  maxRequests: number;
}

export type TenantRateLimitOverrides = Partial<Record<RateLimitTierName, TenantRateLimitOverride>>;

const CACHE_TTL_SECONDS = 300; // 5 minutes

/**
 * Resolves effective rate limit config for a tenant, merging DB overrides with
 * global defaults. Caches results in Redis to avoid a DB hit per request.
 */
export class TenantRateLimitService {
  constructor(private readonly redis: Redis | null) {}

  private cacheKey(organizationId: number): string {
    return `rate_limits:org:${organizationId}`;
  }

  async getOverrides(organizationId: number): Promise<TenantRateLimitOverrides> {
    // 1. Try Redis cache first
    if (this.redis) {
      try {
        const cached = await this.redis.get(this.cacheKey(organizationId));
        if (cached) {
          return JSON.parse(cached) as TenantRateLimitOverrides;
        }
      } catch (err) {
        logger.warn('Redis read failed in TenantRateLimitService', { err });
      }
    }

    // 2. Fall back to DB
    const result = await pool.query(
      `SELECT config_value FROM tenant_configurations
        WHERE organization_id = $1 AND config_key = 'rate_limit_overrides'`,
      [organizationId]
    );

    const overrides: TenantRateLimitOverrides =
      result.rows[0]?.config_value ?? {};

    // 3. Populate cache
    if (this.redis) {
      try {
        await this.redis.setex(
          this.cacheKey(organizationId),
          CACHE_TTL_SECONDS,
          JSON.stringify(overrides)
        );
      } catch (err) {
        logger.warn('Redis write failed in TenantRateLimitService', { err });
      }
    }

    return overrides;
  }

  async setOverrides(
    organizationId: number,
    overrides: TenantRateLimitOverrides
  ): Promise<void> {
    await pool.query(
      `INSERT INTO tenant_configurations (organization_id, config_key, config_value, description)
       VALUES ($1, 'rate_limit_overrides', $2::jsonb, 'Per-tenant rate limit overrides')
       ON CONFLICT (organization_id, config_key)
       DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()`,
      [organizationId, JSON.stringify(overrides)]
    );

    // Invalidate cache so next request picks up the new values
    if (this.redis) {
      try {
        await this.redis.del(this.cacheKey(organizationId));
      } catch (err) {
        logger.warn('Redis delete failed in TenantRateLimitService', { err });
      }
    }

    logger.info('Tenant rate limit overrides updated', { organizationId, overrides });
  }
}

// ---------------------------------------------------------------------------
// Circuit breaker: reduce effective rate limit when a tenant's error rate
// spikes above a configurable threshold within a rolling time window.
// ---------------------------------------------------------------------------

export interface CircuitBreakerState {
  open: boolean;
  openedAt?: Date;
  errorRate: number;
}

const CIRCUIT_BREAKER_WINDOW_MS = 60_000;    // 1 minute rolling window
const CIRCUIT_BREAKER_ERROR_THRESHOLD = 0.20; // 20% error rate triggers open
const CIRCUIT_BREAKER_COOLDOWN_MS = 120_000;  // 2 minute cooldown before half-open

/**
 * Check the circuit breaker state for a given organisation.
 * When the breaker is OPEN, rate limits should be reduced to protect the system.
 */
export async function getCircuitBreakerState(
  organizationId: number,
  redis: Redis | null
): Promise<CircuitBreakerState> {
  if (!redis) return { open: false, errorRate: 0 };

  const now = Date.now();
  const windowKey = `cb:errors:${organizationId}`;
  const totalKey = `cb:total:${organizationId}`;
  const openKey  = `cb:open:${organizationId}`;

  try {
    const [errors, total, openAt] = await Promise.all([
      redis.get(windowKey),
      redis.get(totalKey),
      redis.get(openKey),
    ]);

    const errorCount = parseInt(errors ?? '0', 10);
    const totalCount = parseInt(total ?? '0', 10);
    const errorRate  = totalCount > 0 ? errorCount / totalCount : 0;

    // If breaker is open, check cooldown
    if (openAt) {
      const openedAt = new Date(parseInt(openAt, 10));
      if (now - openedAt.getTime() < CIRCUIT_BREAKER_COOLDOWN_MS) {
        return { open: true, openedAt, errorRate };
      }
      // Cooldown expired — allow half-open (delete open marker)
      await redis.del(openKey);
    }

    // Check if we should trip the breaker
    if (totalCount >= 10 && errorRate >= CIRCUIT_BREAKER_ERROR_THRESHOLD) {
      await redis.setex(openKey, Math.ceil(CIRCUIT_BREAKER_COOLDOWN_MS / 1000), String(now));
      logger.warn('Circuit breaker OPENED for tenant', { organizationId, errorRate, totalCount });
      return { open: true, openedAt: new Date(now), errorRate };
    }

    return { open: false, errorRate };
  } catch (err) {
    logger.warn('Circuit breaker Redis read failed', { err });
    return { open: false, errorRate: 0 };
  }
}

/**
 * Record a request outcome (success or error) for the circuit breaker window.
 */
export async function recordRequestOutcome(
  organizationId: number,
  isError: boolean,
  redis: Redis | null
): Promise<void> {
  if (!redis) return;

  const windowSecs = Math.ceil(CIRCUIT_BREAKER_WINDOW_MS / 1000);
  const totalKey = `cb:total:${organizationId}`;
  const errorKey = `cb:errors:${organizationId}`;

  try {
    const pipeline = redis.pipeline();
    pipeline.incr(totalKey);
    pipeline.expire(totalKey, windowSecs);
    if (isError) {
      pipeline.incr(errorKey);
      pipeline.expire(errorKey, windowSecs);
    }
    await pipeline.exec();
  } catch (err) {
    logger.warn('Circuit breaker Redis write failed', { err });
  }
}
