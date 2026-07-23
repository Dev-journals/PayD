import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import webhookRoutes from '../webhook.routes.js';
import { WebhookService } from '../../services/webhook.service.js';

const JWT_SECRET = 'test-secret';

jest.mock('../../config/env.js', () => ({
  config: { JWT_SECRET: 'test-secret' },
}));

jest.mock('../../config/database.js', () => ({
  pool: {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({}),
      release: jest.fn(),
    }),
  },
}));

jest.mock('../../utils/logger.js', () => ({
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

function makeToken(payload: object): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

const tenantAToken = makeToken({
  id: 1,
  organizationId: 10,
  email: 'admin@orgA.com',
  role: 'EMPLOYER',
});

const tenantBToken = makeToken({
  id: 2,
  organizationId: 20,
  email: 'admin@orgB.com',
  role: 'EMPLOYER',
});

const app = express();
app.use(express.json());
app.use('/webhooks', webhookRoutes);

describe('Webhook Routes - Auth and Tenant Isolation', () => {
  beforeEach(async () => {
    // Clear in-memory subscriptions by listing and deleting for both tenants
    const subsA = WebhookService.listSubscriptions(10);
    for (const s of subsA) WebhookService.deleteSubscription(s.id, 10);
    const subsB = WebhookService.listSubscriptions(20);
    for (const s of subsB) WebhookService.deleteSubscription(s.id, 20);
  });

  describe('Authentication required', () => {
    it('rejects POST /subscribe with no token', async () => {
      const res = await request(app)
        .post('/webhooks/subscribe')
        .send({ url: 'https://example.com/hook', secret: 'a'.repeat(16), events: ['*'] });

      expect(res.status).toBe(401);
    });

    it('rejects GET /subscriptions with no token', async () => {
      const res = await request(app).get('/webhooks/subscriptions');
      expect(res.status).toBe(401);
    });

    it('rejects DELETE /subscriptions/:id with no token', async () => {
      const res = await request(app).delete('/webhooks/subscriptions/fake-id');
      expect(res.status).toBe(401);
    });

    it('rejects POST /test-trigger with no token', async () => {
      const res = await request(app)
        .post('/webhooks/test-trigger')
        .send({ event: 'payment.completed' });

      expect(res.status).toBe(401);
    });

    it('rejects requests with an invalid token', async () => {
      const res = await request(app)
        .get('/webhooks/subscriptions')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(403);
    });
  });

  describe('Tenant isolation', () => {
    it('scopes subscriptions to the creating tenant', async () => {
      const resA = await request(app)
        .post('/webhooks/subscribe')
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({ url: 'https://orgA.example.com/hook', secret: 'a'.repeat(16), events: ['*'] });

      expect(resA.status).toBe(201);
      expect(resA.body.organizationId).toBe(10);

      const listA = await request(app)
        .get('/webhooks/subscriptions')
        .set('Authorization', `Bearer ${tenantAToken}`);

      expect(listA.status).toBe(200);
      expect(listA.body).toHaveLength(1);
      expect(listA.body[0].organizationId).toBe(10);
    });

    it('tenant B cannot see tenant A subscriptions', async () => {
      await request(app)
        .post('/webhooks/subscribe')
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({ url: 'https://orgA.example.com/hook', secret: 'a'.repeat(16), events: ['*'] });

      const listB = await request(app)
        .get('/webhooks/subscriptions')
        .set('Authorization', `Bearer ${tenantBToken}`);

      expect(listB.status).toBe(200);
      expect(listB.body).toHaveLength(0);
    });

    it('tenant B cannot delete tenant A subscription by ID', async () => {
      const createRes = await request(app)
        .post('/webhooks/subscribe')
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({ url: 'https://orgA.example.com/hook', secret: 'a'.repeat(16), events: ['*'] });

      const subId = createRes.body.id;

      const deleteRes = await request(app)
        .delete(`/webhooks/subscriptions/${subId}`)
        .set('Authorization', `Bearer ${tenantBToken}`);

      expect(deleteRes.status).toBe(404);

      const listA = await request(app)
        .get('/webhooks/subscriptions')
        .set('Authorization', `Bearer ${tenantAToken}`);

      expect(listA.body).toHaveLength(1);
    });

    it('tenant can delete their own subscription', async () => {
      const createRes = await request(app)
        .post('/webhooks/subscribe')
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({ url: 'https://orgA.example.com/hook', secret: 'a'.repeat(16), events: ['*'] });

      const subId = createRes.body.id;

      const deleteRes = await request(app)
        .delete(`/webhooks/subscriptions/${subId}`)
        .set('Authorization', `Bearer ${tenantAToken}`);

      expect(deleteRes.status).toBe(204);

      const listA = await request(app)
        .get('/webhooks/subscriptions')
        .set('Authorization', `Bearer ${tenantAToken}`);

      expect(listA.body).toHaveLength(0);
    });
  });

  describe('test-trigger production guard', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('allows test-trigger in development', async () => {
      process.env.NODE_ENV = 'development';

      const res = await request(app)
        .post('/webhooks/test-trigger')
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({ event: 'payment.completed', payload: { id: 'test' } });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Mock event dispatched');
    });

    it('blocks test-trigger in production', async () => {
      process.env.NODE_ENV = 'production';

      const res = await request(app)
        .post('/webhooks/test-trigger')
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({ event: 'payment.completed' });

      expect(res.status).toBe(404);
    });
  });
});
