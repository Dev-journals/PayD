/**
 * Contract Routes
 * Defines routes for the Contract Address Registry API
 */

import { Router } from 'express';
import { ContractController } from '../controllers/contractController.js';
import { authenticateJWT } from '../middlewares/auth.js';
import { syncTenantFromUser } from '../middleware/tenantContext.js';
import { strictTenantBoundary, logTenantAccess } from '../middleware/enhancedTenantIsolation.js';

const router = Router();

router.use(authenticateJWT);
router.use(syncTenantFromUser);
router.use(strictTenantBoundary);
router.use(logTenantAccess);

/**
 * GET /contracts
 * Returns all deployed contract addresses with metadata
 */
router.get('/contracts', ContractController.getContracts);

export default router;
