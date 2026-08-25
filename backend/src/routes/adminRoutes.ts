import { Router, Request, Response } from 'express';
import { auditIntegrityService } from '../services/auditIntegrityService.js';
import { TenantRateLimitService } from '../services/tenantRateLimitService.js';
import { pool } from '../config/database.js';
import { requireAdminJustification } from '../middleware/requireAdminJustification.js';
import { auditSensitiveOperation } from '../middleware/auditLogger.js';
import logger from '../utils/logger.js';

const router = Router();

// ---------------------------------------------------------------------------
// Audit integrity
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/audit/integrity
 * Walk the api_audit_logs hash chain and report whether any records have been
 * tampered with since they were written. Platform-admin only.
 *
 * Query params:
 *   limit  — max rows to check (default 100 000)
 */
router.get(
  '/audit/integrity',
  requireAdminJustification,
  auditSensitiveOperation('audit_integrity_check'),
  async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const result = await auditIntegrityService.verifyIntegrity({ limit });

    res.status(result.passed ? 200 : 409).json({
      status: result.passed ? 'ok' : 'tampered',
      ...result,
    });
  } catch (err: any) {
    logger.error('Audit integrity check failed', { err });
    res.status(500).json({ error: 'Integrity check failed', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// Per-tenant rate limit overrides
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/tenants/:orgId/rate-limits
 * Return the current effective rate limit overrides for an organisation.
 */
router.get('/tenants/:orgId/rate-limits', requireAdminJustification, async (req: Request, res: Response) => {
  const orgId = parseInt(req.params.orgId, 10);
  if (isNaN(orgId)) {
    res.status(400).json({ error: 'Invalid orgId' });
    return;
  }

  try {
    const svc = new TenantRateLimitService(null); // redis injected at startup; null here for route layer
    const overrides = await svc.getOverrides(orgId);
    res.json({ organizationId: orgId, overrides });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/admin/tenants/:orgId/rate-limits
 * Update rate limit overrides for an organisation.
 *
 * Body: { "api": { "windowMs": 60000, "maxRequests": 500 }, ... }
 * Only the tiers provided in the body are updated; omitted tiers keep their current values.
 */
router.patch('/tenants/:orgId/rate-limits', requireAdminJustification, async (req: Request, res: Response) => {
  const orgId = parseInt(req.params.orgId, 10);
  if (isNaN(orgId)) {
    res.status(400).json({ error: 'Invalid orgId' });
    return;
  }

  const overrides = req.body;
  if (!overrides || typeof overrides !== 'object') {
    res.status(400).json({ error: 'Request body must be a JSON object of tier overrides' });
    return;
  }

  try {
    const svc = new TenantRateLimitService(null);
    await svc.setOverrides(orgId, overrides);
    res.json({ organizationId: orgId, overrides, updated: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Platform admin cross-tenant access logs (tenant transparency)
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/access-logs
 * Return platform-admin cross-tenant access log entries.
 * Requires admin justification — this endpoint exposes cross-tenant access data.
 *
 * Query params:
 *   organizationId  — filter by target organisation
 *   adminUserId     — filter by admin user
 *   from            — ISO date lower bound
 *   to              — ISO date upper bound
 *   page, limit
 */
router.get('/access-logs', requireAdminJustification, async (req: Request, res: Response) => {
  const { organizationId, adminUserId, from, to, page = '1', limit = '50' } = req.query;

  const conditions: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (organizationId) { conditions.push(`target_org_id = $${idx++}`); values.push(Number(organizationId)); }
  if (adminUserId)    { conditions.push(`admin_user_id = $${idx++}`); values.push(adminUserId); }
  if (from)           { conditions.push(`created_at >= $${idx++}`);   values.push(new Date(from as string)); }
  if (to)             { conditions.push(`created_at <= $${idx++}`);   values.push(new Date(to as string)); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitN  = Math.min(parseInt(limit as string, 10), 200);
  const offsetN = (parseInt(page as string, 10) - 1) * limitN;

  try {
    const [countRes, rowsRes] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM platform_admin_access_logs ${where}`, values),
      pool.query(
        `SELECT * FROM platform_admin_access_logs ${where}
          ORDER BY created_at DESC
          LIMIT $${idx++} OFFSET $${idx++}`,
        [...values, limitN, offsetN]
      ),
    ]);

    res.json({
      total: parseInt(countRes.rows[0].count, 10),
      page: parseInt(page as string, 10),
      limit: limitN,
      data: rowsRes.rows,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Tenant quota management
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/tenants/:orgId/quotas
 * Return quota config and current usage for an organisation.
 */
router.get('/tenants/:orgId/quotas', requireAdminJustification, async (req: Request, res: Response) => {
  const orgId = parseInt(req.params.orgId, 10);
  if (isNaN(orgId)) { res.status(400).json({ error: 'Invalid orgId' }); return; }

  try {
    const { tenantQuotaService } = await import('../services/tenantQuotaService.js');
    const [quotas, usage] = await Promise.all([
      tenantQuotaService.getQuotas(orgId),
      tenantQuotaService.getCurrentUsage(orgId),
    ]);
    res.json({ organizationId: orgId, quotas, usage });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/admin/tenants/:orgId/quotas
 * Update quota limits for an organisation.
 *
 * Body: { "maxEmployees": 1000, "maxMonthlyTransactions": 50000 }
 */
router.patch('/tenants/:orgId/quotas', requireAdminJustification, async (req: Request, res: Response) => {
  const orgId = parseInt(req.params.orgId, 10);
  if (isNaN(orgId)) { res.status(400).json({ error: 'Invalid orgId' }); return; }

  const { maxEmployees, maxMonthlyTransactions, maxStorageMb } = req.body ?? {};

  try {
    await pool.query(
      `INSERT INTO organization_settings (organization_id, max_employees, max_monthly_transactions, max_storage_mb)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id)
       DO UPDATE SET
         max_employees            = COALESCE(EXCLUDED.max_employees, organization_settings.max_employees),
         max_monthly_transactions = COALESCE(EXCLUDED.max_monthly_transactions, organization_settings.max_monthly_transactions),
         max_storage_mb           = COALESCE(EXCLUDED.max_storage_mb, organization_settings.max_storage_mb),
         updated_at               = NOW()`,
      [orgId, maxEmployees ?? null, maxMonthlyTransactions ?? null, maxStorageMb ?? null]
    );
    res.json({ organizationId: orgId, updated: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
