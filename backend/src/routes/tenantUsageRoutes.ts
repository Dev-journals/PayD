import { Router, Request, Response } from 'express';
import { pool } from '../config/database.js';
import { tenantQuotaService } from '../services/tenantQuotaService.js';
import authenticateJWT from '../middlewares/auth.js';
import { authorizeRoles } from '../middlewares/rbac.js';
import logger from '../utils/logger.js';

const router = Router();

router.use(authenticateJWT);

/**
 * GET /api/usage/quotas
 * Return the calling tenant's quota config and current usage.
 * Accessible to EMPLOYER and ADMIN roles within the organisation.
 */
router.get('/quotas', authorizeRoles('EMPLOYER', 'ADMIN'), async (req: Request, res: Response) => {
  const orgId = req.tenantId ?? req.user?.organizationId;
  if (!orgId) {
    res.status(400).json({ error: 'Tenant context required' });
    return;
  }

  try {
    const [quotas, usage] = await Promise.all([
      tenantQuotaService.getQuotas(orgId),
      tenantQuotaService.getCurrentUsage(orgId),
    ]);

    const utilisation = {
      employees:    Math.round((usage.employeeCount / quotas.maxEmployees) * 100),
      transactions: Math.round((usage.monthlyTransactionCount / quotas.maxMonthlyTransactions) * 100),
      storageMb:    Math.round((usage.storageMb / quotas.maxStorageMb) * 100),
    };

    res.json({ organizationId: orgId, quotas, usage, utilisationPct: utilisation });
  } catch (err: any) {
    logger.error('Failed to fetch tenant quotas', { err, orgId });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/usage/snapshots
 * Return historical daily usage snapshots for the calling tenant.
 *
 * Query params:
 *   from   — ISO date (default: 30 days ago)
 *   to     — ISO date (default: today)
 *   limit  — max rows (default 30, max 365)
 */
router.get('/snapshots', authorizeRoles('EMPLOYER', 'ADMIN'), async (req: Request, res: Response) => {
  const orgId = req.tenantId ?? req.user?.organizationId;
  if (!orgId) {
    res.status(400).json({ error: 'Tenant context required' });
    return;
  }

  const from  = req.query.from  ? new Date(req.query.from as string)  : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to    = req.query.to    ? new Date(req.query.to as string)    : new Date();
  const limit = Math.min(parseInt((req.query.limit as string) ?? '30', 10), 365);

  try {
    const result = await pool.query(
      `SELECT snapshot_date, employee_count, transaction_count, storage_bytes, api_calls
         FROM tenant_usage_snapshots
        WHERE organization_id = $1
          AND snapshot_date BETWEEN $2 AND $3
        ORDER BY snapshot_date DESC
        LIMIT $4`,
      [orgId, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10), limit]
    );

    res.json({ organizationId: orgId, snapshots: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
