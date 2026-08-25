import { Request, Response, NextFunction } from 'express';
import {
  organizationRateLimiter,
  RATE_LIMIT_TIERS,
  generateBypassToken,
  revokeBypassToken,
  getRateLimitStats,
  updateOrganizationTier,
} from '../organizationRateLimiter.js';
import pool from '../../db/index.js';
import logger from '../../utils/logger.js';

jest.mock('../../db/index.js');
jest.mock('../../utils/logger.js');

describe('OrganizationRateLimiter', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;
  let mockPool: jest.Mocked<typeof pool>;
  let setHeaderSpy: jest.Mock;

  beforeEach(() => {
    setHeaderSpy = jest.fn();

    mockRequest = {
      method: 'GET',
      path: '/api/employees',
      headers: {},
      query: {},
      params: {},
      user: { organizationId: 1 } as any,
      socket: { remoteAddress: '127.0.0.1' } as any,
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: setHeaderSpy,
    } as any;

    nextFunction = jest.fn();
    mockPool = pool as jest.Mocked<typeof pool>;
    mockPool.query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ===================================================================
  // RATE_LIMIT_TIERS
  // ===================================================================
  describe('RATE_LIMIT_TIERS', () => {
    it('should define free, standard, premium, and enterprise tiers', () => {
      expect(RATE_LIMIT_TIERS).toHaveProperty('free');
      expect(RATE_LIMIT_TIERS).toHaveProperty('standard');
      expect(RATE_LIMIT_TIERS).toHaveProperty('premium');
      expect(RATE_LIMIT_TIERS).toHaveProperty('enterprise');
    });

    it('should have increasing limits across tiers', () => {
      expect(RATE_LIMIT_TIERS.free.requestsPerMinute).toBeLessThan(
        RATE_LIMIT_TIERS.standard.requestsPerMinute
      );
      expect(RATE_LIMIT_TIERS.standard.requestsPerMinute).toBeLessThan(
        RATE_LIMIT_TIERS.premium.requestsPerMinute
      );
      expect(RATE_LIMIT_TIERS.premium.requestsPerMinute).toBeLessThan(
        RATE_LIMIT_TIERS.enterprise.requestsPerMinute
      );
    });
  });

  // ===================================================================
  // organizationRateLimiter middleware
  // ===================================================================
  describe('organizationRateLimiter middleware', () => {
    it('should allow requests under the rate limit', async () => {
      // Return standard tier for org
      mockPool.query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });

      const middleware = organizationRateLimiter({ defaultTier: 'enterprise' });
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalledWith(429);
    });

    it('should set rate limit headers on response', async () => {
      const middleware = organizationRateLimiter({ defaultTier: 'standard' });
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(setHeaderSpy).toHaveBeenCalledWith('X-RateLimit-Limit-Minute', expect.any(Number));
      expect(setHeaderSpy).toHaveBeenCalledWith('X-RateLimit-Remaining-Minute', expect.any(Number));
      expect(setHeaderSpy).toHaveBeenCalledWith('X-RateLimit-Limit-Hour', expect.any(Number));
      expect(setHeaderSpy).toHaveBeenCalledWith('X-RateLimit-Limit-Day', expect.any(Number));
    });

    it('should bypass rate limit with valid bypass token', async () => {
      mockRequest.headers = { 'x-ratelimit-bypass': 'valid-token-123' };

      // Mock: token found and valid
      mockPool.query = jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              organization_id: 1,
              max_requests: 1000,
              requests_used: 10,
              valid_until: null,
              is_active: true,
            },
          ],
        })
        .mockResolvedValue({ rows: [], rowCount: 1 });

      const middleware = organizationRateLimiter({ enableBypassTokens: true });
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it('should not bypass with invalid token', async () => {
      mockRequest.headers = { 'x-ratelimit-bypass': 'invalid-token' };

      // Mock: no token found
      mockPool.query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });

      const middleware = organizationRateLimiter({
        enableBypassTokens: true,
        defaultTier: 'enterprise',
      });
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      // Should proceed to normal rate limiting (and pass since enterprise has high limit)
      expect(nextFunction).toHaveBeenCalled();
    });

    it('should fall back to standard tier for unknown orgs', async () => {
      mockRequest.user = {} as any; // no organizationId
      mockPool.query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });

      const middleware = organizationRateLimiter();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(setHeaderSpy).toHaveBeenCalledWith(
        'X-RateLimit-Limit-Minute',
        RATE_LIMIT_TIERS.standard.requestsPerMinute
      );
    });
  });

  // ===================================================================
  // generateBypassToken
  // ===================================================================
  describe('generateBypassToken', () => {
    it('should generate a 64-char hex token', async () => {
      const token = await generateBypassToken(1, 'Test bypass token');

      expect(token).toHaveLength(64);
      expect(/^[a-f0-9]+$/.test(token)).toBe(true);
    });

    it('should insert token hash into database', async () => {
      await generateBypassToken(1, 'Integration token', null, 5000, 10);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO rate_limit_bypass_credentials'),
        expect.arrayContaining([1, expect.any(String), expect.any(String), 'Integration token', 5000])
      );
    });
  });

  // ===================================================================
  // revokeBypassToken
  // ===================================================================
  describe('revokeBypassToken', () => {
    it('should deactivate token by prefix', async () => {
      mockPool.query = jest.fn().mockResolvedValue({ rowCount: 1 });

      const result = await revokeBypassToken('abcd1234');

      expect(result).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE rate_limit_bypass_credentials'),
        ['abcd1234']
      );
    });

    it('should return false when token not found', async () => {
      mockPool.query = jest.fn().mockResolvedValue({ rowCount: 0 });

      const result = await revokeBypassToken('nonexist');

      expect(result).toBe(false);
    });
  });

  // ===================================================================
  // getRateLimitStats
  // ===================================================================
  describe('getRateLimitStats', () => {
    it('should query rate limit tracking with date range', async () => {
      const start = new Date('2024-01-01');
      const end = new Date('2024-01-31');
      mockPool.query = jest.fn().mockResolvedValue({
        rows: [
          {
            total_windows: '50',
            total_requests: '5000',
            total_violations: '3',
            peak_requests: '200',
            rate_limit_tier: 'standard',
            endpoint_pattern: 'general',
          },
        ],
      });

      const stats = await getRateLimitStats(1, start, end);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('rate_limit_tracking'),
        [1, start, end]
      );
      expect(stats).toHaveLength(1);
    });
  });

  // ===================================================================
  // updateOrganizationTier
  // ===================================================================
  describe('updateOrganizationTier', () => {
    it('should upsert organization tier with correct limits', async () => {
      await updateOrganizationTier(1, 'premium');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO organization_rate_limits'),
        [
          1,
          'premium',
          RATE_LIMIT_TIERS.premium.requestsPerMinute,
          RATE_LIMIT_TIERS.premium.requestsPerHour,
          RATE_LIMIT_TIERS.premium.requestsPerDay,
          RATE_LIMIT_TIERS.premium.burstAllowance,
        ]
      );
    });

    it('should throw for invalid tier names', async () => {
      await expect(updateOrganizationTier(1, 'nonexistent_tier')).rejects.toThrow(
        'Invalid tier: nonexistent_tier'
      );
    });
  });
});
