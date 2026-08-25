import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db/index.js';
import logger from '../utils/logger.js';

/**
 * Configuration options for request audit logging
 */
export interface RequestAuditConfig {
  /** Include request body in audit logs */
  includeRequestBody?: boolean;
  /** Include response body in audit logs */
  includeResponseBody?: boolean;
  /** Only log requests that result in errors (4xx, 5xx) */
  logErrorsOnly?: boolean;
  /** Paths to skip from audit logging (e.g., health checks) */
  skipPaths?: RegExp[];
  /** Fields to redact from request/response bodies */
  sensitiveFields?: string[];
  /** Maximum body size to log (in bytes) */
  maxBodySize?: number;
}

/**
 * Default sensitive fields to redact from audit logs
 */
const DEFAULT_SENSITIVE_FIELDS = [
  'password',
  'token',
  'secret',
  'apiKey',
  'api_key',
  'authorization',
  'cookie',
  'session',
  'privateKey',
  'private_key',
  'passphrase',
  'creditCard',
  'ssn',
  'taxId',
];

/**
 * Default configuration for request audit logging
 */
const DEFAULT_CONFIG: RequestAuditConfig = {
  includeRequestBody: true,
  includeResponseBody: false, // Often too large
  logErrorsOnly: false,
  skipPaths: [/^\/health/, /^\/metrics/, /^\/api\/status/],
  sensitiveFields: DEFAULT_SENSITIVE_FIELDS,
  maxBodySize: 10000, // 10KB
};

/**
 * Sanitize object by redacting sensitive fields
 */
function sanitizeObject(obj: any, sensitiveFields: string[]): any {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, sensitiveFields));
  }

  const sanitized: any = {};
  for (const [key, value] of Object.entries(obj)) {
    const keyLower = key.toLowerCase();
    const isSensitive = sensitiveFields.some((field) =>
      keyLower.includes(field.toLowerCase())
    );

    if (isSensitive) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object') {
      sanitized[key] = sanitizeObject(value, sensitiveFields);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Truncate large payloads to prevent database bloat
 */
function truncatePayload(payload: any, maxSize: number): any {
  const str = JSON.stringify(payload);
  if (str.length > maxSize) {
    return {
      _truncated: true,
      _originalSize: str.length,
      _truncatedTo: maxSize,
      data: str.substring(0, maxSize) + '...',
    };
  }
  return payload;
}

/**
 * Extract organization ID from request (from JWT token or params)
 */
function getOrganizationId(req: Request): number | null {
  // From authenticated user context
  if (req.user && 'organizationId' in req.user) {
    return (req.user as any).organizationId;
  }

  // From organization context middleware
  if ('organizationId' in req) {
    return (req as any).organizationId;
  }

  // From query params
  if (req.query.organizationId) {
    return parseInt(req.query.organizationId as string, 10);
  }

  // From route params
  if (req.params.organizationId) {
    return parseInt(req.params.organizationId, 10);
  }

  return null;
}

/**
 * Extract user ID from request (from JWT token)
 */
function getUserId(req: Request): number | null {
  if (req.user && 'userId' in req.user) {
    return (req.user as any).userId;
  }

  if (req.user && 'id' in req.user) {
    return (req.user as any).id;
  }

  return null;
}

/**
 * Get client IP address from request
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
 * Async function to save audit log to database
 * Fire-and-forget pattern - don't block request processing
 */
async function saveAuditLog(logData: any): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO request_audit_logs (
        organization_id, user_id, request_id, method, path,
        query_params, request_body, response_status, response_body,
        ip_address, user_agent, request_duration_ms, error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        logData.organizationId,
        logData.userId,
        logData.requestId,
        logData.method,
        logData.path,
        logData.queryParams,
        logData.requestBody,
        logData.responseStatus,
        logData.responseBody,
        logData.ipAddress,
        logData.userAgent,
        logData.requestDurationMs,
        logData.errorMessage,
      ]
    );
  } catch (error) {
    // Don't throw - just log the error
    logger.error('Failed to save request audit log:', error);
  }
}

/**
 * Middleware for comprehensive request/response audit logging
 * 
 * Features:
 * - Logs all API requests with configurable detail
 * - Sanitizes sensitive data (passwords, tokens, etc.)
 * - Tracks request duration
 * - Associates with organization and user
 * - Fire-and-forget database writes (non-blocking)
 * 
 * @param config - Configuration options
 * @returns Express middleware
 */
export function requestAuditLoggerMiddleware(
  config: RequestAuditConfig = {}
): (req: Request, res: Response, next: NextFunction) => void {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  return (req: Request, res: Response, next: NextFunction) => {
    // Check if path should be skipped
    const shouldSkip = finalConfig.skipPaths?.some((pattern) =>
      pattern.test(req.path)
    );

    if (shouldSkip) {
      return next();
    }

    const requestId = uuidv4();
    const startTime = Date.now();

    // Attach request ID to request for tracing
    (req as any).requestId = requestId;

    // Capture original response methods
    const originalSend = res.send;
    const originalJson = res.json;

    let responseBody: any = null;

    // Override res.send to capture response
    res.send = function (body: any): Response {
      if (finalConfig.includeResponseBody) {
        responseBody = body;
      }
      return originalSend.call(this, body);
    };

    // Override res.json to capture response
    res.json = function (body: any): Response {
      if (finalConfig.includeResponseBody) {
        responseBody = body;
      }
      return originalJson.call(this, body);
    };

    // Log after response is sent
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const statusCode = res.statusCode;

      // Skip if only logging errors and this isn't an error
      if (finalConfig.logErrorsOnly && statusCode < 400) {
        return;
      }

      // Prepare audit log data
      const logData = {
        organizationId: getOrganizationId(req),
        userId: getUserId(req),
        requestId,
        method: req.method,
        path: req.path,
        queryParams: Object.keys(req.query).length > 0 ? req.query : null,
        requestBody: finalConfig.includeRequestBody
          ? truncatePayload(
              sanitizeObject(req.body, finalConfig.sensitiveFields!),
              finalConfig.maxBodySize!
            )
          : null,
        responseStatus: statusCode,
        responseBody: finalConfig.includeResponseBody
          ? truncatePayload(
              sanitizeObject(responseBody, finalConfig.sensitiveFields!),
              finalConfig.maxBodySize!
            )
          : null,
        ipAddress: getClientIp(req),
        userAgent: req.headers['user-agent'] || null,
        requestDurationMs: duration,
        errorMessage: statusCode >= 400 ? res.statusMessage : null,
      };

      // Save to database (fire-and-forget)
      saveAuditLog(logData).catch((err) => {
        logger.error('Audit log save failed:', err);
      });

      // Also log to structured logger for real-time monitoring
      const logLevel = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
      logger[logLevel]('Request audit', {
        requestId,
        method: req.method,
        path: req.path,
        status: statusCode,
        duration: `${duration}ms`,
        orgId: logData.organizationId,
        userId: logData.userId,
        ip: logData.ipAddress,
      });
    });

    next();
  };
}

/**
 * Middleware for auditing critical operations
 * Should be applied to sensitive routes (delete, admin actions, etc.)
 * 
 * @param operationType - Type of critical operation (e.g., 'delete_employee', 'change_permissions')
 * @param category - Category of operation ('delete', 'permission', 'financial', 'configuration')
 * @returns Express middleware
 */
export function auditCriticalOperation(
  operationType: string,
  category: 'delete' | 'permission' | 'financial' | 'configuration' = 'delete'
): (req: Request, res: Response, next: NextFunction) => void {
  return async (req: Request, res: Response, next: NextFunction) => {
    const organizationId = getOrganizationId(req);
    const userId = getUserId(req);
    const resourceType = req.path.split('/')[2] || 'unknown'; // e.g., /api/employees/:id -> 'employees'
    const resourceId = req.params.id || req.params[Object.keys(req.params)[0]];

    // Capture before state if this is an update/delete
    let beforeState: any = null;
    if (['PUT', 'PATCH', 'DELETE'].includes(req.method) && resourceId) {
      // The route handler should attach beforeState to the request
      // This requires coordination with controllers
      beforeState = (req as any).beforeState || null;
    }

    // Wait for response to capture after state
    const originalSend = res.send;
    const originalJson = res.json;

    let afterState: any = null;

    res.send = function (body: any): Response {
      afterState = body;
      return originalSend.call(this, body);
    };

    res.json = function (body: any): Response {
      afterState = body;
      return originalJson.call(this, body);
    };

    res.on('finish', async () => {
      // Only log if operation was successful
      if (res.statusCode >= 200 && res.statusCode < 300) {
        try {
          await pool.query(
            `INSERT INTO critical_operations_audit (
              organization_id, user_id, operation_type, operation_category,
              resource_type, resource_id, before_state, after_state,
              justification, ip_address, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              organizationId,
              userId,
              operationType,
              category,
              resourceType,
              resourceId,
              beforeState ? JSON.stringify(beforeState) : null,
              afterState ? JSON.stringify(afterState) : null,
              req.body?.justification || null,
              getClientIp(req),
              JSON.stringify({
                method: req.method,
                path: req.path,
                userAgent: req.headers['user-agent'],
                requestId: (req as any).requestId,
              }),
            ]
          );

          logger.info('Critical operation audited', {
            operationType,
            category,
            resourceType,
            resourceId,
            orgId: organizationId,
            userId,
          });
        } catch (error) {
          logger.error('Failed to audit critical operation:', error);
        }
      }
    });

    next();
  };
}

/**
 * Query audit logs with flexible filters
 */
export interface AuditLogQuery {
  organizationId?: number;
  userId?: number;
  method?: string;
  pathPattern?: string;
  minStatusCode?: number;
  maxStatusCode?: number;
  startDate?: Date;
  endDate?: Date;
  ipAddress?: string;
  limit?: number;
  offset?: number;
}

export async function queryAuditLogs(query: AuditLogQuery): Promise<any[]> {
  const conditions: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (query.organizationId) {
    conditions.push(`organization_id = $${paramCount++}`);
    values.push(query.organizationId);
  }

  if (query.userId) {
    conditions.push(`user_id = $${paramCount++}`);
    values.push(query.userId);
  }

  if (query.method) {
    conditions.push(`method = $${paramCount++}`);
    values.push(query.method);
  }

  if (query.pathPattern) {
    conditions.push(`path LIKE $${paramCount++}`);
    values.push(`%${query.pathPattern}%`);
  }

  if (query.minStatusCode) {
    conditions.push(`response_status >= $${paramCount++}`);
    values.push(query.minStatusCode);
  }

  if (query.maxStatusCode) {
    conditions.push(`response_status <= $${paramCount++}`);
    values.push(query.maxStatusCode);
  }

  if (query.startDate) {
    conditions.push(`created_at >= $${paramCount++}`);
    values.push(query.startDate);
  }

  if (query.endDate) {
    conditions.push(`created_at <= $${paramCount++}`);
    values.push(query.endDate);
  }

  if (query.ipAddress) {
    conditions.push(`ip_address = $${paramCount++}`);
    values.push(query.ipAddress);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitClause = query.limit ? `LIMIT $${paramCount++}` : 'LIMIT 100';
  const offsetClause = query.offset ? `OFFSET $${paramCount++}` : '';

  if (query.limit) values.push(query.limit);
  if (query.offset) values.push(query.offset);

  const sql = `
    SELECT * FROM request_audit_logs
    ${whereClause}
    ORDER BY created_at DESC
    ${limitClause} ${offsetClause}
  `;

  const result = await pool.query(sql, values);
  return result.rows;
}

/**
 * Query critical operations audit logs
 */
export async function queryCriticalOperations(query: AuditLogQuery): Promise<any[]> {
  const conditions: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (query.organizationId) {
    conditions.push(`organization_id = $${paramCount++}`);
    values.push(query.organizationId);
  }

  if (query.userId) {
    conditions.push(`user_id = $${paramCount++}`);
    values.push(query.userId);
  }

  if (query.startDate) {
    conditions.push(`created_at >= $${paramCount++}`);
    values.push(query.startDate);
  }

  if (query.endDate) {
    conditions.push(`created_at <= $${paramCount++}`);
    values.push(query.endDate);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitClause = query.limit ? `LIMIT $${paramCount++}` : 'LIMIT 100';

  if (query.limit) values.push(query.limit);

  const sql = `
    SELECT * FROM critical_operations_audit
    ${whereClause}
    ORDER BY created_at DESC
    ${limitClause}
  `;

  const result = await pool.query(sql, values);
  return result.rows;
}

export default requestAuditLoggerMiddleware;
