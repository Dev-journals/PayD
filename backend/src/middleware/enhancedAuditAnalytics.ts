import { Request, Response, NextFunction } from 'express';
import { auditAnalyticsService } from '../services/auditAnalyticsService.js';
import logger from '../utils/logger.js';

export interface EnhancedAuditOptions {
  logMetrics?: boolean;
  trackPerformance?: boolean;
  trackErrors?: boolean;
  skipPaths?: RegExp[];
}

/**
 * Enhanced audit middleware with analytics capabilities
 */
export function enhancedAuditMiddleware(options: EnhancedAuditOptions = {}) {
  const {
    logMetrics = true,
    trackPerformance = true,
    trackErrors = true,
    skipPaths = [/^\/health/, /^\/metrics/],
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (skipPaths.some((pattern) => pattern.test(req.path))) {
      return next();
    }

    const startTime = Date.now();
    const originalSend = res.send;

    let responseBody: any;

    // Capture response body for error tracking
    if (trackErrors) {
      res.send = function (body: any): Response {
        responseBody = body;
        return originalSend.call(this, body);
      };
    }

    res.on('finish', async () => {
      const duration = Date.now() - startTime;
      const organizationId = req.tenantId || req.user?.organizationId;

      if (!organizationId) return;

      try {
        // Track performance metrics
        if (trackPerformance) {
          await auditAnalyticsService.recordMetric({
            metricType: 'request_duration',
            metricValue: duration,
            dimension: 'method',
            dimensionValue: req.method,
            periodStart: new Date(startTime),
            periodEnd: new Date(),
            metadata: {
              organizationId,
              path: req.path,
              statusCode: res.statusCode,
            },
          });
        }

        // Track errors
        if (trackErrors && res.statusCode >= 400) {
          await auditAnalyticsService.recordMetric({
            metricType: 'error_count',
            metricValue: 1,
            dimension: 'status_code',
            dimensionValue: res.statusCode.toString(),
            periodStart: new Date(startTime),
            periodEnd: new Date(),
            metadata: {
              organizationId,
              path: req.path,
              method: req.method,
              statusCode: res.statusCode,
              errorMessage: extractErrorMessage(responseBody),
            },
          });
        }

        // Log metrics for monitoring
        if (logMetrics) {
          logger.info('Enhanced audit metric', {
            organizationId,
            path: req.path,
            method: req.method,
            statusCode: res.statusCode,
            duration,
            hasError: res.statusCode >= 400,
          });
        }
      } catch (error) {
        logger.error('Failed to record enhanced audit metric', { error, path: req.path });
      }
    });

    next();
  };
}

/**
 * Middleware to track endpoint performance
 */
export function trackEndpointPerformance() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const startTime = Date.now();

    res.on('finish', async () => {
      const duration = Date.now() - startTime;
      const organizationId = req.tenantId || req.user?.organizationId;

      if (!organizationId) return;

      try {
        // Cache performance data for analytics
        await auditAnalyticsService.getCachedAggregation(
          organizationId,
          'endpoint_performance',
          `${req.method}:${req.path}`,
          async () => {
            return {
              method: req.method,
              path: req.path,
              avgDuration: duration,
              lastUpdated: new Date().toISOString(),
            };
          },
          5 // 5 minutes TTL
        );
      } catch (error) {
        logger.error('Failed to track endpoint performance', { error, path: req.path });
      }
    });

    next();
  };
}

/**
 * Middleware to detect and track slow requests
 */
export function trackSlowRequests(thresholdMs: number = 1000) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const startTime = Date.now();

    res.on('finish', async () => {
      const duration = Date.now() - startTime;

      if (duration > thresholdMs) {
        const organizationId = req.tenantId || req.user?.organizationId;

        try {
          await auditAnalyticsService.recordMetric({
            metricType: 'slow_request',
            metricValue: duration,
            dimension: 'threshold',
            dimensionValue: thresholdMs.toString(),
            periodStart: new Date(startTime),
            periodEnd: new Date(),
            metadata: {
              organizationId,
              path: req.path,
              method: req.method,
              statusCode: res.statusCode,
              thresholdMs,
            },
          });

          logger.warn('Slow request detected', {
            organizationId,
            path: req.path,
            method: req.method,
            duration,
            thresholdMs,
          });
        } catch (error) {
          logger.error('Failed to track slow request', { error, path: req.path });
        }
      }
    });

    next();
  };
}

/**
 * Extract error message from response body
 */
function extractErrorMessage(responseBody: any): string | undefined {
  if (!responseBody) return undefined;

  try {
    const body = typeof responseBody === 'string' ? JSON.parse(responseBody) : responseBody;
    return body.error || body.message || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Middleware to track request patterns for anomaly detection
 */
export function trackRequestPatterns() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const organizationId = req.tenantId || req.user?.organizationId;

    if (!organizationId) return next();

    try {
      // Track method distribution
      await auditAnalyticsService.recordMetric({
        metricType: 'method_distribution',
        metricValue: 1,
        dimension: 'method',
        dimensionValue: req.method,
        periodStart: new Date(),
        periodEnd: new Date(),
        metadata: { organizationId },
      });

      // Track path patterns
      const pathParts = req.path.split('/').filter(Boolean);
      if (pathParts.length > 0) {
        const resource = pathParts.find(
          (part) => part !== 'api' && !part.match(/^v\d+$/)
        );

        if (resource) {
          await auditAnalyticsService.recordMetric({
            metricType: 'resource_access',
            metricValue: 1,
            dimension: 'resource',
            dimensionValue: resource,
            periodStart: new Date(),
            periodEnd: new Date(),
            metadata: { organizationId },
          });
        }
      }
    } catch (error) {
      logger.error('Failed to track request patterns', { error, path: req.path });
    }

    next();
  };
}