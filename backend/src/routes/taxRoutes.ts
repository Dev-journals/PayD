import { Router } from 'express';
import { TaxController } from '../controllers/taxController.js';
import { authenticateJWT } from '../middlewares/auth.js';
import { syncTenantFromUser } from '../middleware/tenantContext.js';
import { strictTenantBoundary, logTenantAccess } from '../middleware/enhancedTenantIsolation.js';

const router = Router();

router.use(authenticateJWT);
router.use(syncTenantFromUser);
router.use(strictTenantBoundary);
router.use(logTenantAccess);

// Tax rule CRUD
router.post('/rules', TaxController.createRule);
router.get('/rules', TaxController.getRules);
router.put('/rules/:id', TaxController.updateRule);
router.delete('/rules/:id', TaxController.deleteRule);

// Tax calculation
router.post('/calculate', TaxController.calculateDeductions);

// Tax compliance reports
router.get('/reports', TaxController.getReport);

export default router;
