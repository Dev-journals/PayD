import { Request, Response, NextFunction } from 'express';
import { smartRateLimitService, RateLimitDecision } from '../services/smartRateLimitService.js';
import logger from '../utils/logger.js';

export interface SmartRateLimitOptions {
  organizationBased?: boolean;
  identifier?: (req: Request) => string;
  skip?: (req: Request) => boolean;
  handler?: (req: Request, res: Response, decision: RateLimitDecision) => void;
  logViolations?: boolean;
}

/**
 * Smart rate limiting middleware that adapts based on organization behavior
 */
export function smartRateLimitMiddleware(options: SmartRateLimitOptions = {}) {
  const {
    organizationBased = true,
    identifier = defaultIdentifier,
    skip,
    handler,
    logViolations = true,
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (skip && skip(req)) {
      return next();
    }

    const organizationId = req.tenantId || req.user?.organizationId;

    if (!organizationId && organizationBased) {
      // No organization context, use IP-based limiting
      const clientIdentifier = identifier(req);
      return next();
    }

    try {
      const decision = await smartRateLimitService.checkRateLimit(organizationId);

      // Set rate limit headers
      res.setHeader('X-Smart-RateLimit-Limit', decision.currentLimit);
      res.setHeader('X-Smart-RateLimit-Remaining', decision.remaining);
      res.setHeader('X-Smart-RateLimit-Reset', Math.ceil(decision.resetAt.getTime() / 1000));
      res.setHeader('X-Smart-RateLimit-Behavior', decision.behaviorScore.toString());

      if (decision.isRestricted) {
        res.setHeader('X-Smart-RateLimit-Restricted', 'true');
      }

      if (!decision.allowed) {
        if (decision.retryAfter) {
          res.setHeader('Retry-After', decision.retryAfter);
        }

        // Log violation
        if (logViolations) {
          await smartRateLimitService.recordViolation(organizationId);

          logger.warn('Smart rate limit exceeded', {
            organizationId,
            path: req.path,
            method: req.method,
            behaviorScore: decision.behaviorScore,
            isRestricted: decision.isRestricted,
          });
        }

        if (handler) {
          handler(req, res, decision);
        } else {
          defaultSmartRateLimitHandler(req, res, decision);
        }
        return;
      }

      // Track successful request for behavior score improvement
      await smartRateLimitService.recordSuccess(organizationId);

      next();
    } catch (error) {
      logger.error('Smart rate limit middleware error', { error, path: req.path });
      // Fail open
      next();
    }
  };
}

/**
 * Middleware to protect specific endpoints with stricter limits
 */
export function strictEndpointRateLimit(
  endpointPattern: RegExp,
  strictLimit: number = 10
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!endpointPattern.test(req.path)) {
      return next();
    }

    const organizationId = req.tenantId || req.user?.organizationId;
    if (!organizationId) return next();

    try {
      const decision = await smartRateLimitService.checkRateLimit(organizationId, 1);

      // Apply stricter limit for this endpoint
      if (decision.remaining < strictLimit) {
        res.status(429).json({
          error: 'Too Many Requests',
          message: `Rate limit exceeded for endpoint. Max ${strictLimit} requests.`,
          retryAfter: decision.retryAfter,
          strictLimit,
        });
        return;
      }

      next();
    } catch (error) {
      logger.error('Strict endpoint rate limit error', { error, path: req.path });
      next();
    }
  };
}

/**
 * Middleware to add rate limit status to response
 */
export function addRateLimitStatus() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const organizationId = req.tenantId || req.user?.organizationId;

    if (!organizationId) return next();

    try {
      const decision = await smartRateLimitService.checkRateLimit(organizationId);

      // Add rate limit status to response locals for use in controllers
      res.locals.rateLimitStatus = {
        limit: decision.currentLimit,
        remaining: decision.remaining,
        resetAt: decision.resetAt,
        behaviorScore: decision.behaviorScore,
        isRestricted: decision.isRestricted,
      };
    } catch (error) {
      logger.error('Failed to add rate limit status', { error, path: req.path });
    }

    next();
  };
}

/**
 * Default handler for smart rate limit exceeded
 */
function defaultSmartRateLimitHandler(
  _req: Request,
  res: Response,
  decision: RateLimitDecision
): void {
  res.status(429).json({
    error: 'Too Many Requests',
    message: decision.isRestricted
      ? 'Your organization has been temporarily restricted due to excessive requests.'
      : 'Rate limit exceeded. Please try again later.',
    retryAfter: decision.retryAfter,
    limit: decision.currentLimit,
    resetAt: decision.resetAt,
    behaviorScore: decision.behaviorScore,
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