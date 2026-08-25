import { Request, Response, NextFunction } from 'express';

export interface RateLimitHeaderOverride {
  /** Requests allowed per window for this route. */
  limit: number;
}

export interface RateLimitHeadersOptions {
  /** Fallback limit used when no upstream rate limiter published headers. */
  defaultLimit?: number;
  /** Fallback window (seconds) used to compute a reset time when none is known. */
  defaultWindowSeconds?: number;
  /** Path-prefix overrides, e.g. `{ '/api/auth': { limit: 20 } }`. */
  routeOverrides?: Record<string, RateLimitHeaderOverride>;
}

const DEFAULT_LIMIT = 1000;
const DEFAULT_WINDOW_SECONDS = 60;

function matchRouteOverride(
  path: string,
  overrides: Record<string, RateLimitHeaderOverride> | undefined
): RateLimitHeaderOverride | undefined {
  if (!overrides) return undefined;
  for (const prefix of Object.keys(overrides)) {
    if (path.startsWith(prefix)) return overrides[prefix];
  }
  return undefined;
}

function toEpochSeconds(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') return value;
  const asNumber = Number(value);
  if (!Number.isNaN(asNumber)) return asNumber;
  // organizationRateLimiter publishes its reset as an ISO string; smart and
  // advanced limiters already publish epoch seconds.
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? undefined : Math.ceil(parsed / 1000);
}

/**
 * Normalizes whichever rate limit signal is present on the response
 * (`X-Smart-RateLimit-*` from smartRateLimiter, `X-RateLimit-*-Minute` from
 * organizationRateLimiter, or the already-standard `X-RateLimit-*` from the
 * tiered/advanced limiter) into the standard `X-RateLimit-Limit`,
 * `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers, and guarantees
 * `Retry-After` on 429 responses.
 *
 * Applied to every response — including ones no upstream limiter touched
 * (skipped, bypassed, or anonymous requests) — by falling back to a safe
 * default so the header contract holds unconditionally. Does not change any
 * rate limiting decision or threshold; it only republishes existing
 * information under a consistent name.
 */
export function rateLimitHeaders(options: RateLimitHeadersOptions = {}) {
  const {
    defaultLimit = DEFAULT_LIMIT,
    defaultWindowSeconds = DEFAULT_WINDOW_SECONDS,
    routeOverrides,
  } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    const applyHeaders = (): void => {
      if (res.headersSent) return;

      const smartLimit = res.getHeader('X-Smart-RateLimit-Limit');
      const smartRemaining = res.getHeader('X-Smart-RateLimit-Remaining');
      const smartReset = res.getHeader('X-Smart-RateLimit-Reset');

      const orgLimit = res.getHeader('X-RateLimit-Limit-Minute');
      const orgRemaining = res.getHeader('X-RateLimit-Remaining-Minute');
      const orgReset = res.getHeader('X-RateLimit-Reset-Minute');

      const override = matchRouteOverride(req.path, routeOverrides);

      let limit = override?.limit ?? smartLimit ?? orgLimit ?? res.getHeader('X-RateLimit-Limit');
      let remaining = smartRemaining ?? orgRemaining ?? res.getHeader('X-RateLimit-Remaining');
      let reset = toEpochSeconds(smartReset ?? orgReset ?? res.getHeader('X-RateLimit-Reset'));

      if (limit === undefined) limit = defaultLimit;
      if (remaining === undefined) remaining = limit;
      if (reset === undefined) reset = Math.ceil(Date.now() / 1000) + defaultWindowSeconds;

      res.setHeader('X-RateLimit-Limit', limit);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', reset);

      if (res.statusCode === 429 && !res.getHeader('Retry-After')) {
        res.setHeader('Retry-After', Math.max(0, reset - Math.ceil(Date.now() / 1000)));
      }
    };

    res.json = function (body: unknown): Response {
      applyHeaders();
      return originalJson(body);
    };

    res.send = function (body: unknown): Response {
      applyHeaders();
      return originalSend(body as never);
    };

    next();
  };
}

export default rateLimitHeaders;
