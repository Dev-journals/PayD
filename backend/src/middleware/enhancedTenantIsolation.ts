import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database.js';
import logger from '../utils/logger.js';

/**
 * Enhanced tenant isolation with additional security checks and monitoring
 * Extends the basic tenant context with security hardening
 */

export interface TenantValidationResult {
  valid: boolean;
  organizationId?: number;
  organizationName?: string;
  isActive?: boolean;
  error?: string;
}

/**
 * Strict tenant boundary enforcement middleware
 * Validates that all data access respects tenant boundaries
 */
export const strictTenantBoundary = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!req.tenantId) {
    logger.error('Strict tenant boundary: No tenant ID in request', {
      path: req.path,
      method: req.method,
      userId: req.user?.id,
    });

    res.status(500).json({
      error: 'Tenant context violation',
      message: 'Request must have valid tenant context',
    });
    return;
  }

  // Validate that JWT user's organization matches request tenant
  if (req.user?.organizationId && req.user.organizationId !== req.tenantId) {
    logger.warn('Tenant boundary violation attempt', {
      userId: req.user.id,
      userOrganization: req.user.organizationId,
      requestedTenant: req.tenantId,
      path: req.path,
      method: req.method,
      ipAddress: req.ip,
    });

    res.status(403).json({
      error: 'Access denied',
      message: 'Cannot access resources outside your organization',
    });
    return;
  }

  // Check for any organization IDs in request body that don't match
  if (req.body && typeof req.body === 'object') {
    const bodyOrgId = req.body.organizationId || req.body.organization_id;
    if (bodyOrgId && parseInt(bodyOrgId as string, 10) !== req.tenantId) {
      logger.warn('Tenant boundary violation in request body', {
        userId: req.user?.id,
        tenantId: req.tenantId,
        bodyOrganizationId: bodyOrgId,
        path: req.path,
      });

      res.status(403).json({
        error: 'Access denied',
        message: 'Organization ID in request does not match your tenant',
      });
      return;
    }
  }

  next();
};

/**
 * Middleware to validate tenant is active and in good standing
 */
export const validateActiveTenant = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!req.tenantId) {
    res.status(400).json({
      error: 'Missing tenant context',
      message: 'Tenant ID is required',
    });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT id, name, is_active, subscription_status, created_at 
       FROM organizations 
       WHERE id = $1`,
      [req.tenantId]
    );

    if (result.rows.length === 0) {
      logger.warn('Access attempt to non-existent organization', {
        tenantId: req.tenantId,
        userId: req.user?.id,
        path: req.path,
      });

      res.status(404).json({
        error: 'Organization not found',
        message: 'The specified organization does not exist',
      });
      return;
    }

    const org = result.rows[0];

    // Check if organization is active
    if (!org.is_active) {
      logger.warn('Access attempt to inactive organization', {
        organizationId: org.id,
        organizationName: org.name,
        userId: req.user?.id,
        path: req.path,
      });

      res.status(403).json({
        error: 'Organization inactive',
        message: 'This organization is currently inactive',
      });
      return;
    }

    // Attach organization metadata to request
    (req as any).organizationMeta = {
      id: org.id,
      name: org.name,
      isActive: org.is_active,
      subscriptionStatus: org.subscription_status,
    };

    next();
  } catch (error) {
    logger.error('Error validating active tenant', {
      error,
      tenantId: req.tenantId,
      userId: req.user?.id,
    });

    res.status(500).json({
      error: 'Failed to validate tenant',
      message: 'An error occurred during tenant validation',
    });
  }
};

/**
 * Middleware that logs access to tenant_access_logs for every authenticated
 * request. This gives tenant administrators a full access trail and supports
 * anomaly detection (e.g. spike in unique IPs, unusual paths).
 */
export const logTenantAccess = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // Fire-and-forget — never delay the request for logging
  setImmediate(async () => {
    try {
      const tenantId = req.tenantId || req.user?.organizationId;
      if (!tenantId) return;

      await pool.query(
        `INSERT INTO tenant_access_logs
           (tenant_id, user_id, user_email, user_role, method, path,
            ip_address, user_agent, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NOW())`,
        [
          tenantId,
          req.user?.id ?? null,
          req.user?.email ?? null,
          req.user?.role ?? null,
          req.method,
          req.path,
          req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ?? req.ip ?? null,
          req.headers['user-agent'] ?? null,
        ]
      );
    } catch (err) {
      logger.error('Failed to write tenant_access_log', { err });
    }
  });

  next();
};

/**
 * Middleware to enforce Row Level Security (RLS) at the database level
 * Sets PostgreSQL session variables for automatic tenant filtering
 */
export const enforceRLS = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!req.tenantId) {
    res.status(500).json({
      error: 'RLS enforcement failed',
      message: 'Tenant ID must be set before enforcing RLS',
    });
    return;
  }

  try {
    // Get a dedicated client for this request
    const client = await pool.connect();

    // Set the current tenant in PostgreSQL session
    await client.query('SET LOCAL app.current_tenant_id = $1', [req.tenantId]);

    // Also set the user ID if available for additional audit context
    if (req.user?.id) {
      await client.query('SET LOCAL app.current_user_id = $1', [req.user.id]);
    }

    // Store client reference for cleanup
    (req as any).dbClient = client;

    // Ensure client is released after response
    const cleanup = () => {
      if ((req as any).dbClient) {
        (req as any).dbClient.release();
        (req as any).dbClient = null;
      }
    };

    res.on('finish', cleanup);
    res.on('close', cleanup);

    logger.debug('RLS enforced for request', {
      tenantId: req.tenantId,
      userId: req.user?.id,
      path: req.path,
    });

    next();
  } catch (error) {
    logger.error('Failed to enforce RLS', {
      error,
      tenantId: req.tenantId,
      path: req.path,
    });

    res.status(500).json({
      error: 'Database security enforcement failed',
      message: 'Unable to establish secure database context',
    });
  }
};

/**
 * Monitor and log cross-tenant access attempts
 * This middleware logs all requests for security analysis
 */
export const monitorTenantAccess = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // Log tenant access for security monitoring
  const accessLog = {
    tenantId: req.tenantId,
    userId: req.user?.id,
    userEmail: req.user?.email,
    userRole: req.user?.role,
    method: req.method,
    path: req.path,
    ipAddress: req.ip || req.headers['x-forwarded-for'] || req.headers['x-real-ip'],
    userAgent: req.headers['user-agent'],
    timestamp: new Date(),
  };

  logger.debug('Tenant access', accessLog);

  // Track access patterns in background (don't block request)
  trackAccessPattern(accessLog).catch((error) => {
    logger.error('Failed to track access pattern', { error });
  });

  next();
};

/**
 * Track access patterns for anomaly detection
 */
async function trackAccessPattern(accessLog: any): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO tenant_access_logs (
        tenant_id, user_id, user_email, user_role,
        method, path, ip_address, user_agent, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        accessLog.tenantId,
        accessLog.userId || null,
        accessLog.userEmail || null,
        accessLog.userRole || null,
        accessLog.method,
        accessLog.path,
        accessLog.ipAddress || null,
        accessLog.userAgent || null,
        accessLog.timestamp,
      ]
    );
  } catch (error) {
    // Log but don't throw - tracking shouldn't break requests
    logger.error('Failed to insert tenant access log', { error });
  }
}

/**
 * Validate that query results belong to the correct tenant
 * Use this after database queries to double-check tenant isolation
 */
export function validateResultTenant(
  results: any[],
  expectedTenantId: number,
  tenantField: string = 'organization_id'
): boolean {
  if (!results || results.length === 0) {
    return true; // Empty results are valid
  }

  const invalidResults = results.filter((row) => {
    const rowTenantId = row[tenantField] || row[tenantField.toLowerCase()];
    return rowTenantId && parseInt(rowTenantId, 10) !== expectedTenantId;
  });

  if (invalidResults.length > 0) {
    logger.error('Tenant isolation breach detected in query results', {
      expectedTenantId,
      invalidCount: invalidResults.length,
      sampleInvalidTenantId: invalidResults[0][tenantField],
    });
    return false;
  }

  return true;
}

/**
 * Comprehensive tenant isolation middleware stack
 * Combines all isolation checks for maximum security
 */
export const comprehensiveTenantIsolation = [
  strictTenantBoundary,
  validateActiveTenant,
  enforceRLS,
  monitorTenantAccess,
];

/**
 * Get tenant access statistics for security analysis
 */
export async function getTenantAccessStats(
  tenantId: number,
  startDate: Date,
  endDate: Date
): Promise<{
  totalRequests: number;
  uniqueUsers: number;
  uniqueIPs: number;
  topPaths: Array<{ path: string; count: number }>;
  suspiciousActivity: Array<{ reason: string; count: number }>;
}> {
  const result = await pool.query(
    `SELECT 
      COUNT(*) as total_requests,
      COUNT(DISTINCT user_id) as unique_users,
      COUNT(DISTINCT ip_address) as unique_ips
     FROM tenant_access_logs
     WHERE tenant_id = $1 AND created_at BETWEEN $2 AND $3`,
    [tenantId, startDate, endDate]
  );

  const topPathsResult = await pool.query(
    `SELECT path, COUNT(*) as count
     FROM tenant_access_logs
     WHERE tenant_id = $1 AND created_at BETWEEN $2 AND $3
     GROUP BY path
     ORDER BY count DESC
     LIMIT 10`,
    [tenantId, startDate, endDate]
  );

  // Detect suspicious patterns (multiple IPs for same user, etc.)
  const suspiciousResult = await pool.query(
    `SELECT 
      'Multiple IPs per user' as reason,
      COUNT(*) as count
     FROM (
       SELECT user_id, COUNT(DISTINCT ip_address) as ip_count
       FROM tenant_access_logs
       WHERE tenant_id = $1 AND created_at BETWEEN $2 AND $3 AND user_id IS NOT NULL
       GROUP BY user_id
       HAVING COUNT(DISTINCT ip_address) > 5
     ) suspicious_users`,
    [tenantId, startDate, endDate]
  );

  return {
    totalRequests: parseInt(result.rows[0].total_requests, 10),
    uniqueUsers: parseInt(result.rows[0].unique_users, 10),
    uniqueIPs: parseInt(result.rows[0].unique_ips, 10),
    topPaths: topPathsResult.rows.map((row) => ({
      path: row.path,
      count: parseInt(row.count, 10),
    })),
    suspiciousActivity: suspiciousResult.rows.map((row) => ({
      reason: row.reason,
      count: parseInt(row.count, 10),
    })),
  };
}
