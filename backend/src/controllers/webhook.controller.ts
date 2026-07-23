import { Request, Response } from 'express';
import { WebhookService } from '../services/webhook.service.js';
import { z } from 'zod';

const subscribeSchema = z.object({
  url: z.string().url(),
  secret: z.string().min(16),
  events: z.array(z.string()).default(['*']),
});

export class WebhookController {
  static async subscribe(req: Request, res: Response) {
    try {
      const validatedData = subscribeSchema.parse(req.body);
      const organizationId = req.tenantId!;
      const subscription = await WebhookService.subscribe(
        organizationId,
        validatedData.url,
        validatedData.secret,
        validatedData.events
      );
      res.status(201).json(subscription);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.issues });
        return;
      }
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  static listSubscriptions(req: Request, res: Response) {
    const organizationId = req.tenantId!;
    const subscriptions = WebhookService.listSubscriptions(organizationId);
    res.json(subscriptions);
  }

  static deleteSubscription(req: Request, res: Response) {
    const { id } = req.params;
    const organizationId = req.tenantId!;
    const success = WebhookService.deleteSubscription(id as string, organizationId);
    if (success) {
      res.status(204).send();
      return;
    }
    res.status(404).json({ error: 'Subscription not found' });
  }

  static async triggerMockEvent(req: Request, res: Response) {
    const { event, payload } = req.body;
    await WebhookService.dispatch(
      (event as string) || 'payment.completed',
      payload || { id: 'test_tx_123', amount: 100 }
    );
    res.json({ message: 'Mock event dispatched' });
  }
}
