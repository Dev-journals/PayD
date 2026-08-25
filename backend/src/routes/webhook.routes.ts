import { Router, Request, Response, NextFunction } from 'express';
import { WebhookController } from '../controllers/webhook.controller.js';
import { authenticateJWT } from '../middlewares/auth.js';
import { syncTenantFromUser } from '../middleware/tenantContext.js';
import { strictTenantBoundary, logTenantAccess } from '../middleware/enhancedTenantIsolation.js';

const router = Router();

router.use(authenticateJWT);
router.use(syncTenantFromUser);
router.use(strictTenantBoundary);
router.use(logTenantAccess);

router.post('/subscribe', WebhookController.subscribe);
router.get('/subscriptions', WebhookController.listSubscriptions);
router.delete('/subscriptions/:id', WebhookController.deleteSubscription);

const requireNonProduction = (req: Request, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV === 'production') {
    res.status(404).json({ error: 'Not Found' });
    return;
  }
  next();
};

router.post('/test-trigger', requireNonProduction, WebhookController.triggerMockEvent);

export default router;
