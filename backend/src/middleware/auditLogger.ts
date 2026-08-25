import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database.js';
import logger from '../utils/logger.js';

export interface AuditLogEntry {
  userId?: string;
  userEmail?: string;
  organizationId?: number;
  action: string;
  resource: string;
  resourceId?: string;
  method: string;
  path: string;
  ipAddress?: string;
  userAgent?: string;
  requestBody?: any;
  responseStatus?: number;
  errorMessage?: string;
  metadata?: Record<string, any>;
  duration?: number;
}

export interface AuditMiddlewareOptions {
  logRequestBody?: boolean;
  logResponseBody?: boolean;
  sensitiveFields?: string[];
  skipPaths?: RegExp[];
  logOnlyErrors?: boolean;
}

/**
 * Middleware to automatically audit sensitive API operations
 * Logs to both database and structured logger for compliance
 */
export function auditLoggerMiddleware(options: AuditMiddlewareOptions = {}) {
  const {
    logRequestBody = true,
    logResponseBody = false,
    sensitiveFields = ['password', 'token', 'secret', 'apiKey', 'privateKey'],
    skipPaths = [/^\/health/, /^\/metrics/],
    logOnlyErrors = false,
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Skip non-auditable paths
    if (skipPaths.some((pattern) => pattern.test(req.path))) {
      return next();
    }

    const startTime = Date.now();
    const originalSend = res.send;

    let responseBody: any;

    // Capture response body if configured
    if (logResponseBody) {
      res.send = function (body: any): Response {
        responseBody = body;
        return originalSend.call(this, body);
      };
    }

    // Wait for response to complete
    res.on('finish', async () => {
      const duration = Date.now() - startTime;

      // Skip logging if only errors should be logged and this is a success
      if (logOnlyErrors && res.statusCode < 400) {
        return;
      }

      try {
        const auditEntry: AuditLogEntry = {
          userId: req.user?.id,
          userEmail: req.user?.email,
          organizationId: req.tenantId || req.user?.organizationId,
          action: determineAction(req),
          resource: determineResource(req),
          resourceId: extractResourceId(req),
          method: req.method,
          path: req.path,
          ipAddress: extractIpAddress(req),
          userAgent: req.headers['user-agent'],
          requestBody: logRequestBody ? sanitizeData(req.body, sensitiveFields) : undefined,
          responseStatus: res.statusCode,
          errorMessage: res.statusCode >= 400 ? extractErrorMessage(responseBody) : undefined,
          metadata: {
            query: req.query,
            params: req.params,
            contentType: req.headers['content-type'],
          },
          duration,
        };

        // Log to database for long-term audit trail
        await logToDatabase(auditEntry);

        // Log to structured logger for real-time monitoring
        logger.info('API audit log', {
          ...auditEntry,
          severity: res.statusCode >= 400 ? 'warning' : 'info',
        });
      } catch (error) {
        logger.error('Failed to create audit log', { error, path: req.path });
      }
    });

    next();
  };
}

/**
 * Specialized audit logger for sensitive operations
 * Use this for critical endpoints like admin actions, data deletion, etc.
 */
export function auditSensitiveOperation(operationType: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const startTime = Date.now();

    // Log the attempt
    logger.warn('Sensitive operation attempted', {
      operationType,
      userId: req.user?.id,
      organizationId: req.tenantId,
      path: req.path,
      method: req.method,
      ipAddress: extractIpAddress(req),
    });

    res.on('finish', async () => {
      const duration = Date.now() - startTime;
      const success = res.statusCode < 400;

      try {
        await pool.query(
          `INSERT INTO sensitive_operations_audit (
            organization_id, user_id, user_email, operation_type,
            action, resource, method, path, ip_address, user_agent,
            success, status_code, duration_ms, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())`,
          [
            req.tenantId || req.user?.organizationId,
            req.user?.id || null,
            req.user?.email || null,
            operationType,
            determineAction(req),
            determineResource(req),
            req.method,
            req.path,
            extractIpAddress(req),
            req.headers['user-agent'] || null,
            success,
            res.statusCode,
            duration,
          ]
        );

        logger.info('Sensitive operation completed', {
          operationType,
          success,
          statusCode: res.statusCode,
          duration,
        });
      } catch (error) {
        logger.error('Failed to log sensitive operation', { error, operationType });
      }
    });

    next();
  };
}

/**
 * Helper function to determine the action from the request
 */
function determineAction(req: Request): string {
  const methodActions: Record<string, string> = {
    GET: 'read',
    POST: 'create',
    PUT: 'update',
    PATCH: 'update',
    DELETE: 'delete',
  };

  return methodActions[req.method] || req.method.toLowerCase();
}

/**
 * Helper function to determine the resource from the request path
 */
function determineResource(req: Request): string {
  const pathParts = req.path.split('/').filter(Boolean);
  // Return the first non-api, non-version segment
  return (
    pathParts.find((part) => part !== 'api' && !part.match(/^v\d+$/)) || pathParts[0] || 'unknown'
  );
}

/**
 * Helper function to extract resource ID from request
 */
function extractResourceId(req: Request): string | undefined {
  // Check common ID patterns in params
  return req.params.id || req.params.employeeId || req.params.organizationId || undefined;
}

/**
 * Extract the real IP address considering proxies
 */
function extractIpAddress(req: Request): string {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    (req.headers['x-real-ip'] as string) ||
    req.ip ||
    req.socket.remoteAddress ||
    'unknown'
  );
}

/**
 * Sanitize sensitive data from logs
 */
function sanitizeData(data: any, sensitiveFields: string[]): any {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const sanitized = Array.isArray(data) ? [...data] : { ...data };

  for (const key in sanitized) {
    if (sensitiveFields.some((field) => key.toLowerCase().includes(field.toLowerCase()))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof sanitized[key] === 'object') {
      sanitized[key] = sanitizeData(sanitized[key], sensitiveFields);
    }
  }

  return sanitized;
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
 * Log audit entry to database
 */
async function logToDatabase(entry: AuditLogEntry): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO api_audit_logs (
        user_id, user_email, organization_id, action, resource, resource_id,
        method, path, ip_address, user_agent, request_body, response_status,
        error_message, metadata, duration_ms, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())`,
      [
        entry.userId || null,
        entry.userEmail || null,
        entry.organizationId || null,
        entry.action,
        entry.resource,
        entry.resourceId || null,
        entry.method,
        entry.path,
        entry.ipAddress || null,
        entry.userAgent || null,
        entry.requestBody ? JSON.stringify(entry.requestBody) : null,
        entry.responseStatus,
        entry.errorMessage || null,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
        entry.duration || null,
      ]
    );
  } catch (error) {
    // Don't throw - audit logging should never break the main flow
    logger.error('Failed to write audit log to database', { error });
  }
}

/**
 * Query audit logs with filtering
 */
export async function queryAuditLogs(filters: {
  organizationId?: number;
  userId?: string;
  action?: string;
  resource?: string;
  startDate?: Date;
  endDate?: Date;
  minStatusCode?: number;
  maxStatusCode?: number;
  limit?: number;
  offset?: number;
}): Promise<{ logs: AuditLogEntry[]; total: number }> {
  const conditions: string[] = [];
  const values: any[] = [];
  let paramIdx = 1;

  if (filters.organizationId) {
    conditions.push(`organization_id = $${paramIdx++}`);
    values.push(filters.organizationId);
  }

  if (filters.userId) {
    conditions.push(`user_id = $${paramIdx++}`);
    values.push(filters.userId);
  }

  if (filters.action) {
    conditions.push(`action = $${paramIdx++}`);
    values.push(filters.action);
  }

  if (filters.resource) {
    conditions.push(`resource = $${paramIdx++}`);
    values.push(filters.resource);
  }

  if (filters.startDate) {
    conditions.push(`created_at >= $${paramIdx++}`);
    values.push(filters.startDate);
  }

  if (filters.endDate) {
    conditions.push(`created_at <= $${paramIdx++}`);
    values.push(filters.endDate);
  }

  if (filters.minStatusCode !== undefined) {
    conditions.push(`response_status >= $${paramIdx++}`);
    values.push(filters.minStatusCode);
  }

  if (filters.maxStatusCode !== undefined) {
    conditions.push(`response_status <= $${paramIdx++}`);
    values.push(filters.maxStatusCode);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await pool.query(`SELECT COUNT(*) FROM api_audit_logs ${whereClause}`, values);
  const total = parseInt(countResult.rows[0].count, 10);

  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  const logsResult = await pool.query(
    `SELECT * FROM api_audit_logs ${whereClause} ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...values, limit, offset]
  );

  return {
    logs: logsResult.rows,
    total,
  };
}
