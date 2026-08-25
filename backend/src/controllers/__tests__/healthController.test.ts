import request from 'supertest';
import express from 'express';

// Setup Mock for env config (must be before HealthController import)
jest.mock('../../config/env.js', () => ({
  config: {
    DATABASE_URL: 'postgres://mock:5432/mock',
    REDIS_URL: 'redis://mock:6379/0',
    NODE_ENV: 'test',
  },
}));

import { HealthController, healthConfig } from '../healthController.js';
import pg from 'pg';
import { Redis } from 'ioredis';
import { StellarService } from '../../services/stellarService.js';

// Setup Mock for pg
jest.mock('pg', () => {
  const mPool = { query: jest.fn() };
  return { Pool: jest.fn(() => mPool) };
});

// Setup Mock for ioredis
jest.mock('ioredis', () => {
  const mRedis = { ping: jest.fn() };
  return {
    Redis: jest.fn(() => mRedis),
  };
});

// Setup Mock for StellarService
jest.mock('../../services/stellarService', () => ({
  StellarService: {
    getServer: jest.fn(),
  },
}));

const app = express();
app.get('/health', HealthController.getHealthStatus);
app.get('/health/live', HealthController.getLiveness);

describe('HealthController GET /health/live', () => {
  it('returns 200 OK with liveness status', async () => {
    const response = await request(app).get('/health/live');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.timestamp).toBeDefined();
    expect(response.body.uptime).toBeDefined();
    expect(response.body.version).toBeDefined();
    expect(response.body.environment).toBeDefined();
    expect(response.body.dependencies).toBeUndefined(); // Liveness should NOT contain dependencies
  });
});

describe('HealthController GET /health', () => {
  let pool: any;
  let redisClient: any;
  let mockServer: any;

  beforeEach(() => {
    pool = new pg.Pool();
    redisClient = new Redis();
    mockServer = { feeStats: jest.fn() };
    (StellarService.getServer as jest.Mock).mockReturnValue(mockServer);

    // Reset default timeout
    healthConfig.timeoutMs = 5000;

    jest.clearAllMocks();
  });

  it('returns 200 OK when all dependencies are healthy', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    redisClient.ping.mockResolvedValueOnce('PONG');
    mockServer.feeStats.mockResolvedValueOnce({});

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.dependencies.database.status).toBe('connected');
    expect(response.body.dependencies.redis.status).toBe('connected');
    expect(response.body.dependencies.horizon.status).toBe('connected');
  });

  it('returns 503 Degraded when Postgres goes down', async () => {
    pool.query.mockRejectedValueOnce(new Error('Connection forced closed'));
    redisClient.ping.mockResolvedValueOnce('PONG');
    mockServer.feeStats.mockResolvedValueOnce({});

    const response = await request(app).get('/health');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('degraded');
    expect(response.body.dependencies.database.status).toBe('disconnected');
    expect(response.body.dependencies.database.error).toBe('Connection forced closed');
    expect(response.body.dependencies.redis.status).toBe('connected');
    expect(response.body.dependencies.horizon.status).toBe('connected');
  });

  it('returns 503 Degraded when Redis fails', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    redisClient.ping.mockRejectedValueOnce(new Error('Redis timeout'));
    mockServer.feeStats.mockResolvedValueOnce({});

    const response = await request(app).get('/health');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('degraded');
    expect(response.body.dependencies.database.status).toBe('connected');
    expect(response.body.dependencies.redis.status).toBe('disconnected');
    expect(response.body.dependencies.redis.error).toBe('Redis timeout');
    expect(response.body.dependencies.horizon.status).toBe('connected');
  });

  it('returns 503 Degraded when Horizon fails', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    redisClient.ping.mockResolvedValueOnce('PONG');
    mockServer.feeStats.mockRejectedValueOnce(new Error('Horizon unreachable'));

    const response = await request(app).get('/health');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('degraded');
    expect(response.body.dependencies.database.status).toBe('connected');
    expect(response.body.dependencies.redis.status).toBe('connected');
    expect(response.body.dependencies.horizon.status).toBe('disconnected');
    expect(response.body.dependencies.horizon.error).toBe('Horizon unreachable');
  });

  // Timeout Test Cases
  it('returns 503 Degraded when Postgres query times out', async () => {
    healthConfig.timeoutMs = 50; // set timeout to 50ms
    // Mock db query to hang (resolve after 200ms)
    pool.query.mockReturnValue(new Promise((resolve) => setTimeout(resolve, 200)));
    redisClient.ping.mockResolvedValueOnce('PONG');
    mockServer.feeStats.mockResolvedValueOnce({});

    const response = await request(app).get('/health');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('degraded');
    expect(response.body.dependencies.database.status).toBe('disconnected');
    expect(response.body.dependencies.database.error).toContain('Database query timeout');
  });

  it('returns 503 Degraded when Redis ping times out', async () => {
    healthConfig.timeoutMs = 50; // set timeout to 50ms
    pool.query.mockResolvedValueOnce({ rows: [] });
    // Mock redis ping to hang
    redisClient.ping.mockReturnValue(new Promise((resolve) => setTimeout(resolve, 200)));
    mockServer.feeStats.mockResolvedValueOnce({});

    const response = await request(app).get('/health');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('degraded');
    expect(response.body.dependencies.redis.status).toBe('disconnected');
    expect(response.body.dependencies.redis.error).toContain('Redis ping timeout');
  });

  it('returns 503 Degraded when Horizon feeStats times out', async () => {
    healthConfig.timeoutMs = 50; // set timeout to 50ms
    pool.query.mockResolvedValueOnce({ rows: [] });
    redisClient.ping.mockResolvedValueOnce('PONG');
    // Mock horizon feeStats to hang
    mockServer.feeStats.mockReturnValue(new Promise((resolve) => setTimeout(resolve, 200)));

    const response = await request(app).get('/health');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('degraded');
    expect(response.body.dependencies.horizon.status).toBe('disconnected');
    expect(response.body.dependencies.horizon.error).toContain('Horizon feeStats timeout');
  });
});
