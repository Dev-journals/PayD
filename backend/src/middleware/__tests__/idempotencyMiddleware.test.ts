import { Request, Response, NextFunction } from 'express';
import { idempotencyMiddleware, handleConcurrentDuplicate } from '../idempotencyMiddleware.js';
import * as idempotencyService from '../../services/idempotencyService.js';
import { IdempotencyConflictError } from '../../services/idempotencyService.js';

jest.mock('../../services/idempotencyService.js');
jest.mock('../../utils/logger.js');

describe('idempotencyMiddleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    mockRequest = {
      method: 'POST',
      path: '/api/payments/sep31/initiate',
      headers: {},
      tenantId: 1,
      user: {
        id: 1,
        organizationId: 1,
        role: 'EMPLOYER',
      },
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn(),
      statusCode: 200,
    } as any;

    nextFunction = jest.fn();
    jest.clearAllMocks();
  });

  describe('header extraction', () => {
    it('should pass through when no Idempotency-Key header is present', async () => {
      const middleware = idempotencyMiddleware();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);
      expect(nextFunction).toHaveBeenCalled();
      expect(idempotencyService.claimKey).not.toHaveBeenCalled();
    });

    it('should pass through for GET requests even with header present', async () => {
      mockRequest.method = 'GET';
      mockRequest.headers = { 'idempotency-key': 'test-key-123' };
      const middleware = idempotencyMiddleware();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);
      expect(nextFunction).toHaveBeenCalled();
      expect(idempotencyService.claimKey).not.toHaveBeenCalled();
    });

    it('should accept Idempotency-Key header (case-insensitive)', async () => {
      mockRequest.headers = { 'idempotency-key': 'test-key-123' };
      (idempotencyService.claimKey as jest.Mock).mockResolvedValue(null);

      const middleware = idempotencyMiddleware();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(idempotencyService.claimKey).toHaveBeenCalledWith(
        1,
        'test-key-123',
        expect.any(Number)
      );
      expect(nextFunction).toHaveBeenCalled();
    });
  });

  describe('key validation', () => {
    it('should reject empty key', async () => {
      mockRequest.headers = { 'idempotency-key': '' };
      const middleware = idempotencyMiddleware();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);
      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Invalid Idempotency-Key' })
      );
    });

    it('should reject key exceeding 255 characters', async () => {
      mockRequest.headers = { 'idempotency-key': 'a'.repeat(256) };
      const middleware = idempotencyMiddleware();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);
      expect(mockResponse.status).toHaveBeenCalledWith(400);
    });

    it('should accept key of exactly 255 characters', async () => {
      mockRequest.headers = { 'idempotency-key': 'a'.repeat(255) };
      (idempotencyService.claimKey as jest.Mock).mockResolvedValue(null);
      const middleware = idempotencyMiddleware();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);
      expect(nextFunction).toHaveBeenCalled();
    });
  });

  describe('tenant scoping', () => {
    it('should use req.tenantId when available', async () => {
      mockRequest.tenantId = 42;
      mockRequest.headers = { 'idempotency-key': 'key-1' };
      (idempotencyService.claimKey as jest.Mock).mockResolvedValue(null);

      const middleware = idempotencyMiddleware();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(idempotencyService.claimKey).toHaveBeenCalledWith(42, 'key-1', expect.any(Number));
    });

    it('should fall back to req.user.organizationId', async () => {
      mockRequest.tenantId = undefined;
      mockRequest.user = { id: 1, organizationId: 99, role: 'EMPLOYER' };
      mockRequest.headers = { 'idempotency-key': 'key-1' };
      (idempotencyService.claimKey as jest.Mock).mockResolvedValue(null);

      const middleware = idempotencyMiddleware();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(idempotencyService.claimKey).toHaveBeenCalledWith(99, 'key-1', expect.any(Number));
    });

    it('should pass through without tenant context (fail open)', async () => {
      mockRequest.tenantId = undefined;
      mockRequest.user = undefined;
      mockRequest.headers = { 'idempotency-key': 'key-1' };

      const middleware = idempotencyMiddleware();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(idempotencyService.claimKey).not.toHaveBeenCalled();
    });
  });

  describe('replay handling', () => {
    it('should return stored response on replay', async () => {
      mockRequest.headers = { 'idempotency-key': 'replay-key' };
      const storedResponse = { success: true, data: { id: 1 } };
      (idempotencyService.claimKey as jest.Mock).mockResolvedValue({
        id: 1,
        organizationId: 1,
        idempotencyKey: 'replay-key',
        status: 'completed',
        responseStatus: 201,
        responseBody: storedResponse,
        createdAt: new Date(),
        expiresAt: new Date(),
      });

      const middleware = idempotencyMiddleware();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('Idempotency-Replayed', 'true');
      expect(mockResponse.status).toHaveBeenCalledWith(201);
      expect(mockResponse.json).toHaveBeenCalledWith(storedResponse);
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should replay failed responses too', async () => {
      mockRequest.headers = { 'idempotency-key': 'fail-replay' };
      const errorResponse = { error: 'Bad Request' };
      (idempotencyService.claimKey as jest.Mock).mockResolvedValue({
        id: 2,
        organizationId: 1,
        idempotencyKey: 'fail-replay',
        status: 'failed',
        responseStatus: 400,
        responseBody: errorResponse,
        createdAt: new Date(),
        expiresAt: new Date(),
      });

      const middleware = idempotencyMiddleware();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(errorResponse);
      expect(nextFunction).not.toHaveBeenCalled();
    });
  });

  describe('response interception', () => {
    it('should store successful responses (2xx)', async () => {
      mockRequest.headers = { 'idempotency-key': 'new-key' };
      (idempotencyService.claimKey as jest.Mock).mockResolvedValue(null);
      (idempotencyService.completeKey as jest.Mock).mockResolvedValue(undefined);

      const middleware = idempotencyMiddleware();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      // Simulate the route handler calling res.json
      mockResponse.statusCode = 201;
      const responseBody = { success: true, data: { id: 42 } };
      const interceptedJson = mockResponse.json as any;
      interceptedJson(responseBody);

      // Allow async storage to complete
      await new Promise((r) => setTimeout(r, 10));

      expect(idempotencyService.completeKey).toHaveBeenCalledWith(1, 'new-key', 201, responseBody);
    });

    it('should store client-error responses (4xx)', async () => {
      mockRequest.headers = { 'idempotency-key': 'error-key' };
      (idempotencyService.claimKey as jest.Mock).mockResolvedValue(null);
      (idempotencyService.completeKey as jest.Mock).mockResolvedValue(undefined);

      const middleware = idempotencyMiddleware();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      mockResponse.statusCode = 400;
      const errorBody = { error: 'Bad Request' };
      const interceptedJson = mockResponse.json as any;
      interceptedJson(errorBody);

      await new Promise((r) => setTimeout(r, 10));

      // 4xx is deterministic — stored via completeKey so replays return the same error
      expect(idempotencyService.completeKey).toHaveBeenCalledWith(1, 'error-key', 400, errorBody);
    });

    it('should mark server errors (5xx) as failed for retry', async () => {
      mockRequest.headers = { 'idempotency-key': 'server-error' };
      (idempotencyService.claimKey as jest.Mock).mockResolvedValue(null);
      (idempotencyService.failKey as jest.Mock).mockResolvedValue(undefined);

      const middleware = idempotencyMiddleware();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      mockResponse.statusCode = 500;
      const errorBody = { error: 'Internal Server Error' };
      const interceptedJson = mockResponse.json as any;
      interceptedJson(errorBody);

      await new Promise((r) => setTimeout(r, 10));

      expect(idempotencyService.failKey).toHaveBeenCalledWith(1, 'server-error', 500, errorBody);
      expect(idempotencyService.completeKey).not.toHaveBeenCalled();
    });
  });

  describe('custom options', () => {
    it('should use custom TTL', async () => {
      mockRequest.headers = { 'idempotency-key': 'custom-ttl' };
      (idempotencyService.claimKey as jest.Mock).mockResolvedValue(null);

      const middleware = idempotencyMiddleware({ ttlMs: 3600000 }); // 1 hour
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(idempotencyService.claimKey).toHaveBeenCalledWith(1, 'custom-ttl', 3600000);
    });

    it('should use custom methods filter', async () => {
      mockRequest.method = 'PUT';
      mockRequest.headers = { 'idempotency-key': 'put-key' };
      (idempotencyService.claimKey as jest.Mock).mockResolvedValue(null);

      const middleware = idempotencyMiddleware({ methods: ['POST', 'PUT'] });
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(idempotencyService.claimKey).toHaveBeenCalled();
    });

    it('should use custom key validator', async () => {
      mockRequest.headers = { 'idempotency-key': 'uuid-format' };

      const customValidator = jest.fn().mockReturnValue(true);
      (idempotencyService.claimKey as jest.Mock).mockResolvedValue(null);

      const middleware = idempotencyMiddleware({ validateKey: customValidator });
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(customValidator).toHaveBeenCalledWith('uuid-format');
    });
  });

  describe('error handling', () => {
    it('should return 409 on concurrent duplicate (IdempotencyConflictError)', async () => {
      mockRequest.headers = { 'idempotency-key': 'race-key' };
      (idempotencyService.claimKey as jest.Mock).mockRejectedValue(
        new IdempotencyConflictError(1, 'race-key')
      );

      const middleware = idempotencyMiddleware();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(409);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Conflict' })
      );
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should fail open on non-conflict service errors', async () => {
      mockRequest.headers = { 'idempotency-key': 'error-key' };
      (idempotencyService.claimKey as jest.Mock).mockRejectedValue(new Error('DB down'));

      const middleware = idempotencyMiddleware();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      // Should still proceed to the route handler
      expect(nextFunction).toHaveBeenCalled();
    });
  });
});

describe('handleConcurrentDuplicate', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;

  beforeEach(() => {
    mockRequest = {
      tenantId: 1,
      user: { id: 1, organizationId: 1, role: 'EMPLOYER' },
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as any;
    jest.clearAllMocks();
  });

  it('should return false when no idempotency key on request', async () => {
    const result = await handleConcurrentDuplicate(
      mockRequest as Request,
      mockResponse as Response
    );
    expect(result).toBe(false);
  });

  it('should return false when request is not in-flight', async () => {
    (mockRequest as any).idempotencyKey = 'test-key';
    (idempotencyService.isInFlight as jest.Mock).mockResolvedValue(false);

    const result = await handleConcurrentDuplicate(
      mockRequest as Request,
      mockResponse as Response
    );

    expect(result).toBe(false);
    expect(idempotencyService.isInFlight).toHaveBeenCalledWith(1, 'test-key');
  });

  it('should return 409 when request is in-flight', async () => {
    (mockRequest as any).idempotencyKey = 'test-key';
    (idempotencyService.isInFlight as jest.Mock).mockResolvedValue(true);

    const result = await handleConcurrentDuplicate(
      mockRequest as Request,
      mockResponse as Response
    );

    expect(result).toBe(true);
    expect(mockResponse.status).toHaveBeenCalledWith(409);
    expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Conflict' }));
  });
});
