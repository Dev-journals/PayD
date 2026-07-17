import { Request, Response, NextFunction } from 'express';
import {
  smartRateLimitMiddleware,
  strictEndpointRateLimit,
  addRateLimitStatus,
} from '../smartRateLimiter.js';
import { smartRateLimitService } from '../../services/smartRateLimitService.js';
import logger from '../../utils/logger.js';

jest.mock('../../services/smartRateLimitService.js');
jest.mock('../../utils/logger.js');

describe('Smart Rate Limiter Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    mockRequest = {
      method: 'GET',
      path: '/api/employees',
      tenantId: 1,
      user: {
        id: 'user-123',
        email: 'test@example.com',
        organizationId: 1,
        role: 'EMPLOYER',
      },
      ip: '192.168.1.1',
      headers: {
        'user-agent': 'Jest Test Agent',
      },
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn(),
      locals: {},
    } as any;

    nextFunction = jest.fn();

    (smartRateLimitService.checkRateLimit as jest.Mock) = jest.fn().mockResolvedValue({
      allowed: true,
      currentLimit: 100,
      remaining: 99,
      resetAt: new Date(Date.now() + 3600000),
      behaviorScore: 100,
      isRestricted: false,
    });

    (smartRateLimitService.recordSuccess as jest.Mock) = jest.fn().mockResolvedValue(undefined);
    (smartRateLimitService.recordViolation as jest.Mock) = jest.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('smartRateLimitMiddleware', () => {
    it('should allow requests within limit', async () => {
      const middleware = smartRateLimitMiddleware();

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Smart-RateLimit-Limit', 100);
      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Smart-RateLimit-Remaining', 99);
      expect(smartRateLimitService.recordSuccess).toHaveBeenCalledWith(1);
    });

    it('should block requests exceeding limit', async () => {
      (smartRateLimitService.checkRateLimit as jest.Mock).mockResolvedValue({
        allowed: false,
        currentLimit: 100,
        remaining: 0,
        resetAt: new Date(Date.now() + 3600000),
        retryAfter: 3600,
        behaviorScore: 50,
        isRestricted: false,
      });

      const middleware = smartRateLimitMiddleware();

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(429);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Too Many Requests',
        })
      );
      expect(smartRateLimitService.recordViolation).toHaveBeenCalledWith(1);
    });

    it('should handle restricted organizations', async () => {
      (smartRateLimitService.checkRateLimit as jest.Mock).mockResolvedValue({
        allowed: false,
        currentLimit: 0,
        remaining: 0,
        resetAt: new Date(Date.now() + 3600000),
        retryAfter: 3600,
        behaviorScore: 10,
        isRestricted: true,
      });

      const middleware = smartRateLimitMiddleware();

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(429);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('temporarily restricted'),
        })
      );
    });

    it('should skip when skip function returns true', async () => {
      const middleware = smartRateLimitMiddleware({
        skip: (req) => req.path === '/api/employees',
      });

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(smartRateLimitService.checkRateLimit).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      (smartRateLimitService.checkRateLimit as jest.Mock).mockRejectedValue(
        new Error('Service error')
      );

      const middleware = smartRateLimitMiddleware();

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith('Smart rate limit middleware error', expect.any(Object));
    });
  });

  describe('strictEndpointRateLimit', () => {
    it('should apply strict limit for matching endpoints', async () => {
      mockRequest.path = '/api/admin/delete';
      (smartRateLimitService.checkRateLimit as jest.Mock).mockResolvedValue({
        allowed: true,
        currentLimit: 100,
        remaining: 5,
        resetAt: new Date(Date.now() + 3600000),
        behaviorScore: 100,
        isRestricted: false,
      });

      const middleware = strictEndpointRateLimit(/^\/api\/admin\//, 10);

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it('should block when remaining is below strict limit', async () => {
      mockRequest.path = '/api/admin/delete';
      (smartRateLimitService.checkRateLimit as jest.Mock).mockResolvedValue({
        allowed: true,
        currentLimit: 100,
        remaining: 3,
        resetAt: new Date(Date.now() + 3600000),
        behaviorScore: 100,
        isRestricted: false,
      });

      const middleware = strictEndpointRateLimit(/^\/api\/admin\//, 10);

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(429);
    });

    it('should skip non-matching endpoints', async () => {
      mockRequest.path = '/api/employees';
      const middleware = strictEndpointRateLimit(/^\/api\/admin\//, 10);

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(smartRateLimitService.checkRateLimit).not.toHaveBeenCalled();
    });
  });

  describe('addRateLimitStatus', () => {
    it('should add rate limit status to response locals', async () => {
      const middleware = addRateLimitStatus();

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(mockResponse.locals.rateLimitStatus).toEqual({
        limit: 100,
        remaining: 99,
        resetAt: expect.any(Date),
        behaviorScore: 100,
        isRestricted: false,
      });
    });
  });
});