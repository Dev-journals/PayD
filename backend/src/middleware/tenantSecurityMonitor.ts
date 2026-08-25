import { Request, Response, NextFunction } from 'express';
import pool from '../db/index.js';
import logger from '../utils/logger.js';

/**
 * Security event severity levels
 */
export type SecuritySeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Security event types
 */
export type SecurityEventType =
  | 'unauthorized_access_attempt'
  | 'cross_tenant_access_attempt'
  | 'privilege_escalation_attempt'
  | 'suspicious_query_pattern'
  | 'data_exfiltration_attempt'
  | 'rate_limit_abuse'
  | 'invalid_token'
  | 'brute_force_attempt'
  | 'sql_injection_attempt'
  | 'unusual_access_pattern';

/**
 * Access type for tenant access monitoring
 */
export type AccessType = 'read' | 'write' | 'delete' | 'admin' | 'export';

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
 * Extract user ID from request
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
 * Log security event to database
 */
export async function logSecurityEvent(
  organizationId: number | null,
  userId: number | null,
  eventType: SecurityEventType,
  severity: SecuritySeverity,
  description: string,
  ipAddress: string | null = null,
  userAgent: string | null = null,
  metadata: any = null
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO security_events (
        organization_id, user_id, event_type, severity, description,
        ip_address, user_agent, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        organizationId,
        userId,
        eventType,
        severity,
        description,
        ipAddress,
        userAgent,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );

    logger.warn('Security event logged', {
      eventType,
      severity,
      organizationId,
      userId,
      ipAddress,
    });
  } catch (error) {
    logger.error('Failed to log security event:', error);
  }
}

/**
 * Log tenant access for monitoring
 */
export async function logTenantAccess(
  organizationId: number,
  userId: number | null,
  accessedOrganizationId: number,
  accessType: AccessType,
  resourceType: string,
  resourceId: string | null,
  accessGranted: boolean,
  denialReason: string | null = null,
  ipAddress: string | null = null,
  userAgent: string | null = null
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO tenant_access_monitoring (
        organization_id, user_id, accessed_organization_id, access_type,
        resource_type, resource_id, access_granted, denial_reason,
        ip_address, user_agent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        organizationId,
        userId,
        accessedOrganizationId,
        accessType,
        resourceType,
        resourceId,
        accessGranted,
        denialReason,
        ipAddress,
        userAgent,
      ]
    );
  } catch (error) {
    logger.error('Failed to log tenant access:', error);
  }
}

/**
 * Middleware to enforce strict tenant boundaries
 * Prevents cross-tenant data access
 */
export function strictTenantBoundaryCheck(): (
  req: Request,
  res: Response,
  next: NextFunction
) => void {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userOrganizationId = getOrganizationId(req);
    const userId = getUserId(req);

    if (!userOrganizationId) {
      // No organization context - might be admin or public endpoint
      return next();
    }

    // Check if request is trying to access another organization's data
    const requestedOrganizationId =
      parseInt(req.params.organizationId as string, 10) ||
      parseInt(req.query.organizationId as string, 10) ||
      parseInt(req.body?.organizationId, 10);

    if (requestedOrganizationId && requestedOrganizationId !== userOrganizationId) {
      // Cross-tenant access attempt detected
      const ipAddress = getClientIp(req);
      const userAgent = req.headers['user-agent'] || null;

      // Log the security event
      await logSecurityEvent(
        userOrganizationId,
        userId,
        'cross_tenant_access_attempt',
        'high',
        `User attempted to access organization ${requestedOrganizationId} while belonging to organization ${userOrganizationId}`,
        ipAddress,
        userAgent,
        {
          method: req.method,
          path: req.path,
          requestedOrgId: requestedOrganizationId,
          userOrgId: userOrganizationId,
        }
      );

      // Log tenant access denial
      await logTenantAccess(
        userOrganizationId,
        userId,
        requestedOrganizationId,
        req.method === 'GET' ? 'read' : req.method === 'DELETE' ? 'delete' : 'write',
        req.path.split('/')[2] || 'unknown',
        req.params.id || null,
        false,
        'Cross-tenant access denied',
        ipAddress,
        userAgent
      );

      logger.warn('Cross-tenant access attempt blocked', {
        userOrganizationId,
        requestedOrganizationId,
        userId,
        path: req.path,
        ipAddress,
      });

      return res.status(403).json({
        error: 'Access denied',
        message: 'You do not have permission to access this resource',
      });
    }

    next();
  };
}

/**
 * Middleware to validate organization is active
 */
export function validateActiveTenant(): (
  req: Request,
  res: Response,
  next: NextFunction
) => void {
  return async (req: Request, res: Response, next: NextFunction) => {
    const organizationId = getOrganizationId(req);

    if (!organizationId) {
      return next();
    }

    try {
      const result = await pool.query(
        `SELECT id, name, is_active, status FROM organizations WHERE id = $1`,
        [organizationId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'Organization not found',
          message: 'The specified organization does not exist',
        });
      }

      const organization = result.rows[0];

      // Check if organization is suspended or inactive
      if (!organization.is_active || organization.status === 'suspended') {
        const userId = getUserId(req);
        const ipAddress = getClientIp(req);

        await logSecurityEvent(
          organizationId,
          userId,
          'unauthorized_access_attempt',
          'medium',
          `Access attempt to inactive/suspended organization ${organizationId}`,
          ipAddress,
          req.headers['user-agent'] || null,
          { organizationStatus: organization.status }
        );

        return res.status(403).json({
          error: 'Organization inactive',
          message: 'This organization is currently inactive or suspended',
        });
      }

      // Attach organization info to request
      (req as any).organization = organization;

      next();
    } catch (error) {
      logger.error('Error validating tenant:', error);
      return res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to validate organization',
      });
    }
  };
}

/**
 * Middleware to monitor and log tenant access patterns
 */
export function monitorTenantAccessPattern(): (
  req: Request,
  res: Response,
  next: NextFunction
) => void {
  return async (req: Request, res: Response, next: NextFunction) => {
    const organizationId = getOrganizationId(req);
    const userId = getUserId(req);

    if (!organizationId) {
      return next();
    }

    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] || null;

    // Determine access type
    let accessType: AccessType = 'read';
    if (req.method === 'DELETE') {
      accessType = 'delete';
    } else if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      accessType = 'write';
    } else if (req.path.includes('/admin/')) {
      accessType = 'admin';
    } else if (req.path.includes('/export/')) {
      accessType = 'export';
    }

    // Extract resource info
    const resourceType = req.path.split('/')[2] || 'unknown';
    const resourceId = req.params.id || req.params[Object.keys(req.params)[0]] || null;

    // Log the access (fire-and-forget)
    logTenantAccess(
      organizationId,
      userId,
      organizationId, // Same org for normal access
      accessType,
      resourceType,
      resourceId,
      true, // Granted if we reach here
      null,
      ipAddress,
      userAgent
    ).catch((err) => logger.error('Failed to log tenant access:', err));

    next();
  };
}

/**
 * Middleware to detect and prevent SQL injection attempts
 */
export function detectSqlInjection(): (
  req: Request,
  res: Response,
  next: NextFunction
) => void {
  const SQL_INJECTION_PATTERNS = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE)\b)/i,
    /(--|\#|\/\*|\*\/)/,
    /(\bOR\b\s+\d+\s*=\s*\d+)/i,
    /(\bUNION\b.*\bSELECT\b)/i,
    /(;.*\b(DROP|DELETE|UPDATE)\b)/i,
  ];

  return async (req: Request, res: Response, next: NextFunction) => {
    const organizationId = getOrganizationId(req);
    const userId = getUserId(req);
    const ipAddress = getClientIp(req);

    // Check query parameters
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === 'string') {
        for (const pattern of SQL_INJECTION_PATTERNS) {
          if (pattern.test(value)) {
            await logSecurityEvent(
              organizationId,
              userId,
              'sql_injection_attempt',
              'critical',
              `SQL injection attempt detected in query parameter "${key}"`,
              ipAddress,
              req.headers['user-agent'] || null,
              { parameter: key, value, pattern: pattern.source }
            );

            logger.error('SQL injection attempt blocked', {
              organizationId,
              userId,
              parameter: key,
              value,
              ipAddress,
            });

            return res.status(400).json({
              error: 'Invalid request',
              message: 'The request contains potentially malicious content',
            });
          }
        }
      }
    }

    // Check body parameters
    if (req.body && typeof req.body === 'object') {
      const checkObject = (obj: any, path: string = ''): boolean => {
        for (const [key, value] of Object.entries(obj)) {
          if (typeof value === 'string') {
            for (const pattern of SQL_INJECTION_PATTERNS) {
              if (pattern.test(value)) {
                logSecurityEvent(
                  organizationId,
                  userId,
                  'sql_injection_attempt',
                  'critical',
                  `SQL injection attempt detected in body parameter "${path}${key}"`,
                  ipAddress,
                  req.headers['user-agent'] || null,
                  { parameter: `${path}${key}`, value, pattern: pattern.source }
                ).catch((err) => logger.error('Failed to log security event:', err));

                return true;
              }
            }
          } else if (typeof value === 'object' && value !== null) {
            if (checkObject(value, `${path}${key}.`)) {
              return true;
            }
          }
        }
        return false;
      };

      if (checkObject(req.body)) {
        logger.error('SQL injection attempt blocked in body', {
          organizationId,
          userId,
          ipAddress,
        });

        return res.status(400).json({
          error: 'Invalid request',
          message: 'The request contains potentially malicious content',
        });
      }
    }

    next();
  };
}

/**
 * Comprehensive tenant security middleware stack
 * Combines all security checks
 */
export function comprehensiveTenantSecurity(): (
  req: Request,
  res: Response,
  next: NextFunction
) => void {
  return async (req: Request, res: Response, next: NextFunction) => {
    const chain = [
      strictTenantBoundaryCheck(),
      validateActiveTenant(),
      monitorTenantAccessPattern(),
      detectSqlInjection(),
    ];

    const executeChain = async (index: number): Promise<void> => {
      if (index >= chain.length) {
        return next();
      }

      return new Promise((resolve, reject) => {
        chain[index](req, res, (err?: any) => {
          if (err) {
            reject(err);
          } else if (res.headersSent) {
            resolve();
          } else {
            executeChain(index + 1).then(resolve).catch(reject);
          }
        });
      });
    };

    try {
      await executeChain(0);
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Get tenant access statistics
 */
export async function getTenantAccessStats(
  organizationId: number,
  startDate: Date,
  endDate: Date
): Promise<any> {
  const result = await pool.query(
    `SELECT
      COUNT(*) as total_accesses,
      COUNT(DISTINCT user_id) as unique_users,
      COUNT(DISTINCT ip_address) as unique_ips,
      access_type,
      resource_type,
      COUNT(*) FILTER (WHERE access_granted = false) as denied_accesses
     FROM tenant_access_monitoring
     WHERE organization_id = $1
       AND created_at >= $2
       AND created_at <= $3
     GROUP BY access_type, resource_type
     ORDER BY total_accesses DESC`,
    [organizationId, startDate, endDate]
  );

  return result.rows;
}

/**
 * Get security events for organization
 */
export async function getSecurityEvents(
  organizationId: number,
  severity?: SecuritySeverity,
  resolved?: boolean,
  limit: number = 100
): Promise<any[]> {
  const conditions = ['organization_id = $1'];
  const values: any[] = [organizationId];

  if (severity) {
    conditions.push(`severity = $${values.length + 1}`);
    values.push(severity);
  }

  if (resolved !== undefined) {
    conditions.push(`resolved = $${values.length + 1}`);
    values.push(resolved);
  }

  values.push(limit);

  const result = await pool.query(
    `SELECT * FROM security_events
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${values.length}`,
    values
  );

  return result.rows;
}

/**
 * Resolve a security event
 */
export async function resolveSecurityEvent(
  eventId: number,
  resolvedBy: number
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE security_events
     SET resolved = true, resolved_at = CURRENT_TIMESTAMP, resolved_by = $2
     WHERE id = $1`,
    [eventId, resolvedBy]
  );

  return result.rowCount > 0;
}

/**
 * Detect anomalous access patterns
 */
export async function detectAnomalousAccess(
  organizationId: number,
  lookbackMinutes: number = 60
): Promise<any> {
  const result = await pool.query(
    `SELECT
      user_id,
      COUNT(DISTINCT ip_address) as distinct_ips,
      COUNT(DISTINCT resource_type) as distinct_resources,
      COUNT(*) as total_accesses,
      COUNT(*) FILTER (WHERE access_granted = false) as failed_accesses
     FROM tenant_access_monitoring
     WHERE organization_id = $1
       AND created_at >= NOW() - INTERVAL '${lookbackMinutes} minutes'
     GROUP BY user_id
     HAVING COUNT(DISTINCT ip_address) > 3
        OR COUNT(*) > 100
        OR COUNT(*) FILTER (WHERE access_granted = false) > 10
     ORDER BY total_accesses DESC`,
    [organizationId]
  );

  return result.rows;
}

export default {
  strictTenantBoundaryCheck,
  validateActiveTenant,
  monitorTenantAccessPattern,
  detectSqlInjection,
  comprehensiveTenantSecurity,
  logSecurityEvent,
  logTenantAccess,
  getTenantAccessStats,
  getSecurityEvents,
  resolveSecurityEvent,
  detectAnomalousAccess,
};
