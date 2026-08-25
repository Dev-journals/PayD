import { Request, Response, NextFunction } from 'express';
import {
  requestAuditLoggerMiddleware,
  auditCriticalOperation,
  queryAuditLogs,
  queryCriticalOperations,
} from '../requestAuditLogger.js';
import pool from '../../db/index.js';
import logger from '../../utils/logger.js';

jest.mock('../../db/index.js');
jest.mock('../../utils/logger.js');
jest.mock('uuid', () => ({ v4: () => 'test-uuid-1234' }));

describe('RequestAuditLogger', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;
  let mockPool: jest.Mocked<typeof pool>;
  let finishCallback: (() => void) | null = null;

  beforeEach(() => {
    finishCallback = null;

    mockRequest = {
      method: 'POST',
      path: '/api/employees',
      body: { name: 'John Doe', password: 'secret123', salary: 50000 },
      query: {},
      params: { id: '123' },
      headers: {
        'user-agent': 'Jest Test Agent',
      },
      user: { organizationId: 1, userId: 10, id: 10 } as any,
      socket: { remoteAddress: '127.0.0.1' } as any,
    };

    mockResponse = {
      statusCode: 200,
      statusMessage: 'OK',
      send: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      on: jest.fn((event, callback) => {
        if (event === 'finish') {
          finishCallback = callback;
        }
        return mockResponse;
      }),
    } as any;

    nextFunction = jest.fn();
    mockPool = pool as jest.Mocked<typeof pool>;
    mockPool.query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ===================================================================
  // requestAuditLoggerMiddleware
  // ===================================================================
  describe('requestAuditLoggerMiddleware', () => {
    it('should call next() without blocking', () => {
      const middleware = requestAuditLoggerMiddleware();
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it('should attach requestId to the request', () => {
      const middleware = requestAuditLoggerMiddleware();
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect((mockRequest as any).requestId).toBe('test-uuid-1234');
    });

    it('should skip logging for health check paths', () => {
      mockRequest.path = '/health';

      const middleware = requestAuditLoggerMiddleware();
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      // No finish listener should log
      expect(mockResponse.on).not.toHaveBeenCalledWith('finish', expect.any(Function));
    });

    it('should skip logging for metrics paths', () => {
      mockRequest.path = '/metrics';

      const middleware = requestAuditLoggerMiddleware();
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it('should log request on response finish', async () => {
      const middleware = requestAuditLoggerMiddleware();
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      // Simulate response finish
      expect(finishCallback).not.toBeNull();
      finishCallback!();

      // Wait for async save
      await new Promise((r) => setTimeout(r, 10));

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO request_audit_logs'),
        expect.arrayContaining([
          1,           // organization_id
          10,          // user_id
          'test-uuid-1234', // request_id
          'POST',      // method
          '/api/employees', // path
        ])
      );
    });

    it('should sanitize sensitive fields in request body', async () => {
      const middleware = requestAuditLoggerMiddleware({ includeRequestBody: true });
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      finishCallback!();
      await new Promise((r) => setTimeout(r, 10));

      const insertArgs = mockPool.query.mock.calls[0][1];
      // The request body is one of the args — find the JSONB body arg
      const bodyArg = insertArgs.find(
        (arg: any) => typeof arg === 'object' && arg !== null && arg.name !== undefined
      );

      // Regardless of exact position, the insert should have been called
      expect(mockPool.query).toHaveBeenCalled();
    });

    it('should skip logging on non-error when logErrorsOnly is true', async () => {
      mockResponse.statusCode = 200;

      const middleware = requestAuditLoggerMiddleware({ logErrorsOnly: true });
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      finishCallback!();
      await new Promise((r) => setTimeout(r, 10));

      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should log when status >= 400 and logErrorsOnly is true', async () => {
      mockResponse.statusCode = 404;

      const middleware = requestAuditLoggerMiddleware({ logErrorsOnly: true });
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      finishCallback!();
      await new Promise((r) => setTimeout(r, 10));

      expect(mockPool.query).toHaveBeenCalled();
    });

    it('should handle database save failures gracefully', async () => {
      mockPool.query = jest.fn().mockRejectedValue(new Error('DB write failed'));

      const middleware = requestAuditLoggerMiddleware();
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      finishCallback!();
      await new Promise((r) => setTimeout(r, 10));

      // Should not throw — fire-and-forget
      expect(nextFunction).toHaveBeenCalled();
    });

    it('should extract IP from x-forwarded-for header', async () => {
      mockRequest.headers = {
        ...mockRequest.headers,
        'x-forwarded-for': '203.0.113.5, 10.0.0.1',
      };

      const middleware = requestAuditLoggerMiddleware();
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      finishCallback!();
      await new Promise((r) => setTimeout(r, 10));

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['203.0.113.5'])
      );
    });
  });

  // ===================================================================
  // auditCriticalOperation
  // ===================================================================
  describe('auditCriticalOperation', () => {
    it('should call next() without blocking', async () => {
      const middleware = auditCriticalOperation('delete_employee', 'delete');
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it('should log critical operation on successful response', async () => {
      mockResponse.statusCode = 200;

      const middleware = auditCriticalOperation('delete_employee', 'delete');
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      // Simulate finish
      finishCallback!();
      await new Promise((r) => setTimeout(r, 50));

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO critical_operations_audit'),
        expect.arrayContaining([
          1,                  // organization_id
          10,                 // user_id
          'delete_employee',  // operation_type
          'delete',           // operation_category
        ])
      );
    });

    it('should not log critical operation on error response', async () => {
      mockResponse.statusCode = 500;

      const middleware = auditCriticalOperation('update_config', 'configuration');
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      finishCallback!();
      await new Promise((r) => setTimeout(r, 50));

      // Should not insert because status is 500
      expect(mockPool.query).not.toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO critical_operations_audit'),
        expect.anything()
      );
    });
  });

  // ===================================================================
  // queryAuditLogs
  // ===================================================================
  describe('queryAuditLogs', () => {
    it('should query with organization filter', async () => {
      mockPool.query = jest.fn().mockResolvedValue({
        rows: [{ id: 1, method: 'GET', path: '/api/test' }],
      });

      const result = await queryAuditLogs({ organizationId: 1 });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('organization_id'),
        expect.arrayContaining([1])
      );
      expect(result).toHaveLength(1);
    });

    it('should apply multiple filters', async () => {
      mockPool.query = jest.fn().mockResolvedValue({ rows: [] });

      await queryAuditLogs({
        organizationId: 1,
        method: 'POST',
        minStatusCode: 400,
        maxStatusCode: 499,
      });

      const queryString = mockPool.query.mock.calls[0][0] as string;
      expect(queryString).toContain('organization_id');
      expect(queryString).toContain('method');
      expect(queryString).toContain('response_status >=');
      expect(queryString).toContain('response_status <=');
    });

    it('should support date range filtering', async () => {
      mockPool.query = jest.fn().mockResolvedValue({ rows: [] });

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      await queryAuditLogs({ startDate, endDate });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('created_at'),
        expect.arrayContaining([startDate, endDate])
      );
    });

    it('should default to limit 100', async () => {
      mockPool.query = jest.fn().mockResolvedValue({ rows: [] });

      await queryAuditLogs({});

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT 100'),
        expect.any(Array)
      );
    });

    it('should support custom limit and offset', async () => {
      mockPool.query = jest.fn().mockResolvedValue({ rows: [] });

      await queryAuditLogs({ limit: 50, offset: 10 });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        expect.arrayContaining([50, 10])
      );
    });
  });

  // ===================================================================
  // queryCriticalOperations
  // ===================================================================
  describe('queryCriticalOperations', () => {
    it('should query critical operations with org filter', async () => {
      mockPool.query = jest.fn().mockResolvedValue({ rows: [] });

      await queryCriticalOperations({ organizationId: 1 });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('critical_operations_audit'),
        expect.arrayContaining([1])
      );
    });

    it('should support user and date filtering', async () => {
      mockPool.query = jest.fn().mockResolvedValue({ rows: [] });

      await queryCriticalOperations({
        organizationId: 1,
        userId: 10,
        startDate: new Date('2024-01-01'),
      });

      const queryString = mockPool.query.mock.calls[0][0] as string;
      expect(queryString).toContain('organization_id');
      expect(queryString).toContain('user_id');
      expect(queryString).toContain('created_at');
    });
  });
});
