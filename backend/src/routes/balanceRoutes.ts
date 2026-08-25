import { Router } from 'express';
import { BalanceController } from '../controllers/balanceController.js';
import { authenticateJWT } from '../middlewares/auth.js';
import { syncTenantFromUser } from '../middleware/tenantContext.js';
import { strictTenantBoundary, logTenantAccess } from '../middleware/enhancedTenantIsolation.js';

const router = Router();

router.use(authenticateJWT);
router.use(syncTenantFromUser);
router.use(strictTenantBoundary);
router.use(logTenantAccess);

/**
 * @route GET /api/balance/:accountId
 * @desc Query ORGUSD balance for a Stellar account
 * @query assetIssuer - The ORGUSD issuer public key
 */
router.get('/:accountId', BalanceController.checkBalance);

/**
 * @route POST /api/balance/preflight
 * @desc Run preflight balance check before payroll execution.
 *       Aborts with a shortfall report if ORGUSD balance
 *       is insufficient to cover all scheduled payments.
 * @body { distributionAccount, assetIssuer, payments[] }
 */
router.post('/preflight', BalanceController.preflightPayroll);

export default router;
