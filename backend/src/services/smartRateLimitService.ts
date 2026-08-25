import { pool } from '../config/database.js';
import logger from '../utils/logger.js';

export interface SmartRateLimitConfig {
  organizationId: number;
  baseLimit: number;
  burstLimit: number;
  cooldownPeriodSeconds: number;
  adaptationFactor: number;
  behaviorScore: number;
  isRestricted: boolean;
  restrictedUntil: Date | null;
}

export interface RateLimitDecision {
  allowed: boolean;
  currentLimit: number;
  remaining: number;
  resetAt: Date;
  retryAfter?: number;
  behaviorScore: number;
  isRestricted: boolean;
}

export interface RateLimitRecovery {
  previousLimit: number;
  newLimit: number;
  reason: string;
  behaviorScoreBefore: number;
  behaviorScoreAfter: number;
}

/**
 * Service for smart rate limiting based on organization behavior
 */
export class SmartRateLimitService {
  /**
   * Get or create smart rate limit config for an organization
   */
  async getConfig(organizationId: number): Promise<SmartRateLimitConfig> {
    try {
      const result = await pool.query(
        `SELECT * FROM smart_rate_limit_configs
         WHERE organization_id = $1`,
        [organizationId]
      );

      if (result.rows.length > 0) {
        const row = result.rows[0];
        return {
          organizationId: row.organization_id,
          baseLimit: row.base_limit,
          burstLimit: row.burst_limit,
          cooldownPeriodSeconds: row.cooldown_period_seconds,
          adaptationFactor: row.adaptation_factor,
          behaviorScore: parseFloat(row.behavior_score),
          isRestricted: row.is_restricted,
          restrictedUntil: row.restricted_until ? new Date(row.restricted_until) : null,
        };
      }

      // Create default config
      const defaultConfig: SmartRateLimitConfig = {
        organizationId,
        baseLimit: 100,
        burstLimit: 200,
        cooldownPeriodSeconds: 300,
        adaptationFactor: 1.0,
        behaviorScore: 100.0,
        isRestricted: false,
        restrictedUntil: null,
      };

      await pool.query(
        `INSERT INTO smart_rate_limit_configs (
          organization_id, base_limit, burst_limit, cooldown_period_seconds,
          adaptation_factor, behavior_score, is_restricted
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          organizationId,
          defaultConfig.baseLimit,
          defaultConfig.burstLimit,
          defaultConfig.cooldownPeriodSeconds,
          defaultConfig.adaptationFactor,
          defaultConfig.behaviorScore,
          defaultConfig.isRestricted,
        ]
      );

      return defaultConfig;
    } catch (error) {
      logger.error('Failed to get smart rate limit config', { error, organizationId });
      return {
        organizationId,
        baseLimit: 100,
        burstLimit: 200,
        cooldownPeriodSeconds: 300,
        adaptationFactor: 1.0,
        behaviorScore: 100.0,
        isRestricted: false,
        restrictedUntil: null,
      };
    }
  }

  /**
   * Check rate limit for an organization
   */
  async checkRateLimit(
    organizationId: number,
    requestCount: number = 1
  ): Promise<RateLimitDecision> {
    try {
      const config = await this.getConfig(organizationId);

      // Check if organization is restricted
      if (config.isRestricted && config.restrictedUntil) {
        if (new Date() < config.restrictedUntil) {
          return {
            allowed: false,
            currentLimit: 0,
            remaining: 0,
            resetAt: config.restrictedUntil,
            retryAfter: Math.ceil((config.restrictedUntil.getTime() - Date.now()) / 1000),
            behaviorScore: config.behaviorScore,
            isRestricted: true,
          };
        } else {
          // Restriction expired, remove it
          await this.removeRestriction(organizationId);
          config.isRestricted = false;
          config.restrictedUntil = null;
        }
      }

      // Calculate effective limit based on behavior score
      const effectiveLimit = this.calculateEffectiveLimit(config);

      // Get current usage in the current window
      const currentUsage = await this.getCurrentUsage(organizationId);
      const remaining = Math.max(0, effectiveLimit - currentUsage);

      if (remaining < requestCount) {
        const resetAt = this.getWindowResetTime();
        return {
          allowed: false,
          currentLimit: effectiveLimit,
          remaining,
          resetAt,
          retryAfter: Math.ceil((resetAt.getTime() - Date.now()) / 1000),
          behaviorScore: config.behaviorScore,
          isRestricted: config.isRestricted,
        };
      }

      return {
        allowed: true,
        currentLimit: effectiveLimit,
        remaining: remaining - requestCount,
        resetAt: this.getWindowResetTime(),
        behaviorScore: config.behaviorScore,
        isRestricted: config.isRestricted,
      };
    } catch (error) {
      logger.error('Failed to check smart rate limit', { error, organizationId });
      // Fail open
      return {
        allowed: true,
        currentLimit: 100,
        remaining: 99,
        resetAt: this.getWindowResetTime(),
        behaviorScore: 100,
        isRestricted: false,
      };
    }
  }

  /**
   * Record a rate limit violation
   */
  async recordViolation(organizationId: number): Promise<void> {
    try {
      await pool.query(
        `UPDATE smart_rate_limit_configs
         SET consecutive_violations = consecutive_violations + 1,
             last_violation_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE organization_id = $1`,
        [organizationId]
      );

      // Check if we need to restrict the organization
      const config = await this.getConfig(organizationId);
      if (config.consecutive_violations >= 5 && config.behaviorScore < 30) {
        await this.restrictOrganization(
          organizationId,
          'Excessive rate limit violations',
          config.behaviorScore
        );
      }
    } catch (error) {
      logger.error('Failed to record violation', { error, organizationId });
    }
  }

  /**
   * Record a successful request (for behavior score improvement)
   */
  async recordSuccess(organizationId: number): Promise<void> {
    try {
      // Reset consecutive violations on success
      await pool.query(
        `UPDATE smart_rate_limit_configs
         SET consecutive_violations = 0,
             updated_at = CURRENT_TIMESTAMP
         WHERE organization_id = $1
         AND consecutive_violations > 0`,
        [organizationId]
      );
    } catch (error) {
      logger.error('Failed to record success', { error, organizationId });
    }
  }

  /**
   * Calculate effective limit based on behavior score
   */
  private calculateEffectiveLimit(config: SmartRateLimitConfig): number {
    // Behavior score affects the limit (0-100 scale)
    // Higher score = higher limit
    const scoreFactor = config.behaviorScore / 100;
    const adaptedLimit = Math.round(config.baseLimit * config.adaptationFactor * scoreFactor);

    // Ensure minimum limit
    return Math.max(10, Math.min(adaptedLimit, config.burstLimit));
  }

  /**
   * Get current usage in the current window
   */
  private async getCurrentUsage(organizationId: number): Promise<number> {
    try {
      const windowStart = this.getWindowStart();
      const result = await pool.query(
        `SELECT COUNT(*) as usage
         FROM api_audit_logs
         WHERE organization_id = $1
         AND created_at >= $2`,
        [organizationId, windowStart]
      );

      return parseInt(result.rows[0].usage, 10) || 0;
    } catch (error) {
      logger.error('Failed to get current usage', { error, organizationId });
      return 0;
    }
  }

  /**
   * Get window start time (current hour)
   */
  private getWindowStart(): Date {
    const now = new Date();
    now.setMinutes(0, 0, 0);
    return now;
  }

  /**
   * Get window reset time (next hour)
   */
  private getWindowResetTime(): Date {
    const now = new Date();
    now.setHours(now.getHours() + 1, 0, 0, 0);
    return now;
  }

  /**
   * Restrict an organization
   */
  private async restrictOrganization(
    organizationId: number,
    reason: string,
    behaviorScore: number
  ): Promise<void> {
    try {
      const restrictedUntil = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await pool.query(
        `UPDATE smart_rate_limit_configs
         SET is_restricted = TRUE,
             restricted_until = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE organization_id = $2`,
        [restrictedUntil, organizationId]
      );

      // Log recovery
      await pool.query(
        `INSERT INTO rate_limit_recovery_log (
          organization_id, previous_limit, new_limit, reason,
          behavior_score_before, behavior_score_after, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
        [organizationId, 100, 0, reason, behaviorScore, behaviorScore]
      );

      logger.warn('Organization restricted due to poor behavior', {
        organizationId,
        reason,
        behaviorScore,
        restrictedUntil,
      });
    } catch (error) {
      logger.error('Failed to restrict organization', { error, organizationId });
    }
  }

  /**
   * Remove restriction from an organization
   */
  private async removeRestriction(organizationId: number): Promise<void> {
    try {
      await pool.query(
        `UPDATE smart_rate_limit_configs
         SET is_restricted = FALSE,
             restricted_until = NULL,
             consecutive_violations = 0,
             updated_at = CURRENT_TIMESTAMP
         WHERE organization_id = $1`,
        [organizationId]
      );

      logger.info('Organization restriction removed', { organizationId });
    } catch (error) {
      logger.error('Failed to remove restriction', { error, organizationId });
    }
  }

  /**
   * Get rate limit recovery history for an organization
   */
  async getRecoveryHistory(
    organizationId: number,
    limit: number = 10
  ): Promise<RateLimitRecovery[]> {
    try {
      const result = await pool.query(
        `SELECT 
          previous_limit, new_limit, reason,
          behavior_score_before, behavior_score_after
         FROM rate_limit_recovery_log
         WHERE organization_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [organizationId, limit]
      );

      return result.rows.map((row) => ({
        previousLimit: row.previous_limit,
        newLimit: row.new_limit,
        reason: row.reason,
        behaviorScoreBefore: parseFloat(row.behavior_score_before),
        behaviorScoreAfter: parseFloat(row.behavior_score_after),
      }));
    } catch (error) {
      logger.error('Failed to get recovery history', { error, organizationId });
      return [];
    }
  }

  /**
   * Update behavior score for an organization
   */
  async updateBehaviorScore(
    organizationId: number,
    scoreDelta: number
  ): Promise<void> {
    try {
      await pool.query(
        `UPDATE smart_rate_limit_configs
         SET behavior_score = GREATEST(0, LEAST(100, behavior_score + $1)),
             updated_at = CURRENT_TIMESTAMP
         WHERE organization_id = $2`,
        [scoreDelta, organizationId]
      );
    } catch (error) {
      logger.error('Failed to update behavior score', { error, organizationId });
    }
  }
}

export const smartRateLimitService = new SmartRateLimitService();