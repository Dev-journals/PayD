import { Router } from 'express';
import { PayrollBonusController } from '../controllers/payrollBonusController.js';
import { authenticateJWT } from '../middlewares/auth.js';
import { isolateOrganization } from '../middlewares/rbac.js';
import { idempotencyMiddleware } from '../middleware/idempotencyMiddleware.js';

const router = Router();

router.use(authenticateJWT);
router.use(isolateOrganization);

router.post('/runs', idempotencyMiddleware(), PayrollBonusController.createPayrollRun);
router.get('/runs', PayrollBonusController.listPayrollRuns);
router.get('/runs/:id', PayrollBonusController.getPayrollRun);
router.patch('/runs/:id/status', PayrollBonusController.updatePayrollRunStatus);
router.post('/items/bonus', idempotencyMiddleware(), PayrollBonusController.addBonusItem);
router.post('/items/bonus/batch', idempotencyMiddleware(), PayrollBonusController.addBatchBonusItems);
router.get('/runs/:payrollRunId/items', PayrollBonusController.getPayrollItems);
router.delete('/items/:itemId', PayrollBonusController.deletePayrollItem);
router.get('/bonuses/history', PayrollBonusController.getBonusHistory);

export default router;
