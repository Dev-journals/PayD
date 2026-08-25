import { Request, Response, NextFunction } from 'express';
import { tenantQuotaService, QuotaExceededError } from '../services/tenantQuotaService.js';

/**
 * Express middleware factory that asserts a quota before the handler runs.
 *
 * Usage:
 *   router.post('/transactions',
 *     authenticateJWT,
 *     quotaGuard('transactions'),
 *     transactionController.create
 *   );
 */
export function quotaGuard(resource: 'employees' | 'transactions') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const orgId = req.tenantId ?? req.user?.organizationId;
    if (!orgId) {
      next();
      return;
    }

    try {
      if (resource === 'employees') {
        await tenantQuotaService.assertEmployeeQuota(orgId);
      } else if (resource === 'transactions') {
        await tenantQuotaService.assertTransactionQuota(orgId);
      }
      next();
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        res.setHeader('X-Quota-Resource', err.resource);
        res.status(429).json({
          error: 'Quota exceeded',
          resource: err.resource,
          current: err.current,
          limit: err.limit,
          message: `Your organisation has reached its ${err.resource} quota (${err.current}/${err.limit}). Contact support to increase your limit.`,
        });
      } else {
        next(err);
      }
    }
  };
}
