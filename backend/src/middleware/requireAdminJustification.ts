import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database.js';
import logger from '../utils/logger.js';

const JUSTIFICATION_HEADER = 'x-admin-reason';
const MIN_JUSTIFICATION_LENGTH = 10;

/**
 * Middleware for platform-admin routes that access another tenant's data.
 *
 * Enforces two invariants:
 *  1. The request must carry a non-empty X-Admin-Reason header explaining why
 *     the admin needs cross-tenant access. Requests without it are rejected 403
 *     before they touch any data.
 *  2. Every access — including the justification text — is written to
 *     platform_admin_access_logs so tenant administrators can audit which
 *     platform admins accessed their data and why.
 *
 * Usage:
 *   router.get('/tenants/:orgId/employees',
 *     requireAdminJustification,
 *     employeeController.listForAdmin
 *   );
 */
export async function requireAdminJustification(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const justification = req.headers[JUSTIFICATION_HEADER];

  if (!justification || typeof justification !== 'string' || justification.trim().length < MIN_JUSTIFICATION_LENGTH) {
    logger.warn('Platform admin access blocked — missing or too short justification', {
      adminUserId: req.user?.id,
      path: req.path,
      method: req.method,
      ip: req.ip,
    });

    res.status(403).json({
      error: 'Admin justification required',
      message: `Cross-tenant access requires the '${JUSTIFICATION_HEADER}' header with a justification of at least ${MIN_JUSTIFICATION_LENGTH} characters.`,
      header: JUSTIFICATION_HEADER,
    });
    return;
  }

  // Determine the target org from URL params (:orgId or :organizationId)
  const targetOrgId = parseInt(
    (req.params.orgId || req.params.organizationId || '') as string,
    10
  );

  // Log AFTER the response so we capture the status code
  res.on('finish', async () => {
    try {
      await pool.query(
        `INSERT INTO platform_admin_access_logs (
          admin_user_id, admin_email, target_org_id, justification,
          action, resource, resource_id, method, path,
          ip_address, user_agent, session_id, response_status, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, NOW())`,
        [
          req.user?.id ?? 'unknown',
          req.user?.email ?? null,
          isNaN(targetOrgId) ? null : targetOrgId,
          justification.trim(),
          req.method === 'GET' ? 'read' : req.method === 'DELETE' ? 'delete' : 'write',
          req.path.split('/').filter((p) => p && !/^\d+$/.test(p) && p !== 'api' && !/^v\d+$/.test(p))[0] ?? 'unknown',
          req.params.id ?? req.params.employeeId ?? null,
          req.method,
          req.path,
          req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ?? req.ip ?? null,
          req.headers['user-agent'] ?? null,
          req.headers['x-session-id']?.toString() ?? null,
          res.statusCode,
        ]
      );
    } catch (err) {
      logger.error('Failed to write platform_admin_access_log', { err });
    }
  });

  next();
}
