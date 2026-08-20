import { Request, Response, NextFunction } from 'express';
import * as idempotencyService from '../services/idempotencyService.js';
import { IdempotencyConflictError } from '../services/idempotencyService.js';
import logger from '../utils/logger.js';

const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_KEY_LENGTH = 255;

export interface IdempotencyMiddlewareOptions {
  /** TTL for idempotency keys in milliseconds. Default: 24 hours. */
  ttlMs?: number;
  /** Only apply to these HTTP methods. Default: ['POST']. */
  methods?: string[];
  /** Custom key validator. Default: checks length <= 255. */
  validateKey?: (key: string) => boolean;
}

/**
 * Express middleware that provides idempotency-key deduplication for POST routes.
 *
 * Reads the `Idempotency-Key` header. On first request, stores the key in
 * in_progress state and proceeds. On replay (key exists with completed/failed
 * status), returns the cached response. On concurrent duplicate (key exists
 * in_progress from another request), returns 409 Conflict.
 *
 * Must be applied AFTER authentication middleware (needs req.tenantId or
 * req.user.organizationId for tenant scoping).
 */
export function idempotencyMiddleware(options: IdempotencyMiddlewareOptions = {}) {
  const { ttlMs = DEFAULT_TTL_MS, methods = ['POST'], validateKey = defaultValidateKey } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Only apply to configured HTTP methods
    if (!methods.includes(req.method.toUpperCase())) {
      return next();
    }

    const rawKey = req.headers[IDEMPOTENCY_KEY_HEADER];
    if (rawKey === undefined || rawKey === null || typeof rawKey !== 'string') {
      return next();
    }

    const idempotencyKey = rawKey.trim();

    if (!validateKey(idempotencyKey)) {
      res.status(400).json({
        error: 'Invalid Idempotency-Key',
        message: `Idempotency-Key must be a non-empty string of at most ${MAX_KEY_LENGTH} characters`,
      });
      return;
    }

    // Tenant scope: prefer req.tenantId, fall back to req.user.organizationId
    const organizationId = req.tenantId ?? req.user?.organizationId;
    if (!organizationId) {
      // No tenant context available — skip idempotency (shouldn't happen on
      // protected routes, but degrade gracefully rather than block).
      return next();
    }

    try {
      // Attempt to claim the key.
      const existing = await idempotencyService.claimKey(organizationId, idempotencyKey, ttlMs);

      if (existing) {
        // Replay: return the stored response
        logger.info('Idempotency replay', {
          organizationId,
          idempotencyKey,
          originalStatus: existing.responseStatus,
        });

        res.setHeader('Idempotency-Replayed', 'true');
        res.status(existing.responseStatus ?? 200).json(existing.responseBody);
        return;
      }

      // New request — intercept the response to store the result.
      const originalJson = res.json.bind(res);

      res.json = function (body: unknown) {
        // Store the result asynchronously (don't block the response).
        const statusCode = res.statusCode;

        // Only store successful or client-error responses.
        // 5xx errors are not stored so retries can attempt again.
        if (statusCode < 500) {
          idempotencyService
            .completeKey(organizationId, idempotencyKey, statusCode, body)
            .catch((err) => {
              logger.error('Failed to store idempotency result', {
                organizationId,
                idempotencyKey,
                error: err,
              });
            });
        } else {
          // Server errors: mark as failed so retries work
          idempotencyService
            .failKey(organizationId, idempotencyKey, statusCode, body)
            .catch((err) => {
              logger.error('Failed to mark idempotency key as failed', {
                organizationId,
                idempotencyKey,
                error: err,
              });
            });
        }

        return originalJson(body);
      } as typeof res.json;

      // If a concurrent duplicate arrives while we're processing,
      // it will see in_progress status. Handle via 409.
      // We set a flag so downstream handlers know this is an idempotent request.
      (req as any).idempotencyKey = idempotencyKey;

      next();
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        logger.warn('Concurrent duplicate detected', {
          organizationId,
          idempotencyKey,
        });
        res.status(409).json({
          error: 'Conflict',
          message: 'A request with this Idempotency-Key is already being processed',
        });
        return;
      }

      logger.error('Idempotency middleware error', {
        organizationId,
        idempotencyKey,
        error,
      });
      // On other errors, proceed without idempotency (fail open)
      next();
    }
  };
}

/**
 * Handle concurrent duplicate detection.
 * Call this in route handlers that do the actual work (e.g., after async operations).
 * Returns true if this is a concurrent duplicate and the response was already sent.
 */
export async function handleConcurrentDuplicate(req: Request, res: Response): Promise<boolean> {
  const idempotencyKey = (req as any).idempotencyKey;
  if (!idempotencyKey) return false;

  const organizationId = req.tenantId ?? req.user?.organizationId;
  if (!organizationId) return false;

  const inFlight = await idempotencyService.isInFlight(organizationId, idempotencyKey);
  if (inFlight) {
    res.status(409).json({
      error: 'Conflict',
      message: 'A request with this Idempotency-Key is already being processed',
    });
    return true;
  }
  return false;
}

function defaultValidateKey(key: string): boolean {
  return key.length > 0 && key.length <= MAX_KEY_LENGTH;
}

export default idempotencyMiddleware;
