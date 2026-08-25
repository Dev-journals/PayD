import { Request, Response, NextFunction } from 'express';
import { auditLoggerMiddleware, auditSensitiveOperation, queryAuditLogs } from '../auditLogger.js';
import { pool } from '../../config/database.js';
import logger from '../../utils/logger.js';

jest.mock('../../config/database.js');
jest.mock('../../utils/logger.js');

describe('Audit Logger Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;
  let mockPool: jest.Mocked<typeof pool>;

  beforeEach(() => {
    mockRequest = {
      method: 'POST',
      path: '/api/employees',
      body: { name: 'John Doe', salary: 50000, password: 'secret123' },
      query: {},
      params: { id: '123' },
      headers: {
        'user-agent': 'Jest Test Agent',
        'content-type': 'application/json',
      },
      user: {
        id: 'user-123',
        email: 'test@example.com',
        organizationId: 1,
        role: 'EMPLOYER',
      },
      tenantId: 1,
      ip: '192.168.1.1',
    };

    mockResponse = {
      statusCode: 200,
      send: jest.fn().mockReturnThis(),
      on: jest.fn((event, callback) => {
        if (event === 'finish') {
          // Simulate immediate finish for testing
          setTimeout(callback, 0);
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

  describe('auditLoggerMiddleware', () => {
    it('should log API request with sanitized sensitive data', async () => {
      const middleware = auditLoggerMiddleware({ logRequestBody: true });

      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();

      // Wait for async logging
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO api_audit_logs'),
        expect.arrayContaining([
          'user-123',
          'test@example.com',
          1,
          'create',
          'employees',
          '123',
          'POST',
          '/api/employees',
          '192.168.1.1',
          'Jest Test Agent',
          expect.stringContaining('[REDACTED]'), // password should be redacted
          200,
          null,
          expect.any(String),
          expect.any(Number),
        ])
      );
    });

    it('should skip logging for excluded paths', async () => {
      const middleware = auditLoggerMiddleware({
        skipPaths: [/^\/health/, /^\/api\/employees/],
      });

      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should log only errors when logOnlyErrors is true', async () => {
      const middleware = auditLoggerMiddleware({ logOnlyErrors: true });
      mockResponse.statusCode = 200;

      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should log errors when status code is 400+', async () => {
      const middleware = auditLoggerMiddleware({ logOnlyErrors: true });
      mockResponse.statusCode = 403;

      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockPool.query).toHaveBeenCalled();
    });

    it('should handle logging errors gracefully', async () => {
      mockPool.query = jest.fn().mockRejectedValue(new Error('Database error'));
      const middleware = auditLoggerMiddleware();

      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to write audit log to database',
        expect.any(Object)
      );
    });

    it('should extract IP address from X-Forwarded-For header', async () => {
      mockRequest.headers = {
        ...mockRequest.headers,
        'x-forwarded-for': '203.0.113.0, 192.168.1.1',
      };
      mockRequest.ip = '10.0.0.1';

      const middleware = auditLoggerMiddleware();
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['203.0.113.0'])
      );
    });
  });

  describe('auditSensitiveOperation', () => {
    it('should log sensitive operation attempt and completion', async () => {
      const middleware = auditSensitiveOperation('admin_delete_employee');

      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'Sensitive operation attempted',
        expect.objectContaining({
          operationType: 'admin_delete_employee',
          userId: 'user-123',
          organizationId: 1,
        })
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO sensitive_operations_audit'),
        expect.arrayContaining([
          1,
          'user-123',
          'test@example.com',
          'admin_delete_employee',
          'create',
          'employees',
          'POST',
          '/api/employees',
          '192.168.1.1',
          'Jest Test Agent',
          true,
          200,
          expect.any(Number),
        ])
      );
    });

    it('should mark operation as failed for error status codes', async () => {
      mockResponse.statusCode = 500;
      const middleware = auditSensitiveOperation('admin_delete_organization');

      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([false, 500])
      );
    });
  });

  describe('queryAuditLogs', () => {
    it('should query audit logs with filters', async () => {
      mockPool.query = jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ count: '10' }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              action: 'create',
              resource: 'employee',
              created_at: new Date(),
            },
          ],
        });

      const result = await queryAuditLogs({
        organizationId: 1,
        action: 'create',
        startDate: new Date('2024-01-01'),
        limit: 20,
        offset: 0,
      });

      expect(result.total).toBe(10);
      expect(result.logs).toHaveLength(1);
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });

    it('should apply status code filters', async () => {
      mockPool.query = jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ count: '5' }] })
        .mockResolvedValueOnce({ rows: [] });

      await queryAuditLogs({
        minStatusCode: 400,
        maxStatusCode: 499,
      });

      const callArgs = mockPool.query.mock.calls[0];
      expect(callArgs[0]).toContain('response_status >=');
      expect(callArgs[0]).toContain('response_status <=');
    });
  });

  describe('Data Sanitization', () => {
    it('should redact sensitive fields in nested objects', async () => {
      mockRequest.body = {
        user: {
          name: 'John',
          credentials: {
            password: 'secret',
            apiKey: 'key-123',
          },
        },
      };

      const middleware = auditLoggerMiddleware({ logRequestBody: true });
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const loggedBody = JSON.parse(mockPool.query.mock.calls[0][1][10]);
      expect(loggedBody.user.credentials.password).toBe('[REDACTED]');
      expect(loggedBody.user.credentials.apiKey).toBe('[REDACTED]');
      expect(loggedBody.user.name).toBe('John');
    });

    it('should sanitize arrays of objects', async () => {
      mockRequest.body = {
        users: [
          { name: 'User1', password: 'pass1' },
          { name: 'User2', password: 'pass2' },
        ],
      };

      const middleware = auditLoggerMiddleware({ logRequestBody: true });
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const loggedBody = JSON.parse(mockPool.query.mock.calls[0][1][10]);
      expect(loggedBody.users[0].password).toBe('[REDACTED]');
      expect(loggedBody.users[1].password).toBe('[REDACTED]');
    });
  });
});
