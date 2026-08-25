import { Request, Response, NextFunction } from 'express';
import {
  strictTenantBoundary,
  validateActiveTenant,
  enforceRLS,
  monitorTenantAccess,
  validateResultTenant,
  getTenantAccessStats,
} from '../enhancedTenantIsolation.js';
import { pool } from '../../config/database.js';
import logger from '../../utils/logger.js';

jest.mock('../../config/database.js');
jest.mock('../../utils/logger.js');

describe('Enhanced Tenant Isolation Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;
  let mockPool: jest.Mocked<typeof pool>;
  let mockClient: any;

  beforeEach(() => {
    mockRequest = {
      tenantId: 1,
      user: {
        id: 'user-123',
        email: 'test@example.com',
        organizationId: 1,
        role: 'EMPLOYER',
      },
      body: {},
      path: '/api/employees',
      method: 'GET',
      ip: '192.168.1.1',
      headers: {
        'user-agent': 'Jest Test Agent',
      },
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      on: jest.fn().mockReturnThis(),
    } as any;

    nextFunction = jest.fn();

    mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    };

    mockPool = pool as jest.Mocked<typeof pool>;
    mockPool.query = jest.fn().mockResolvedValue({ rows: [] });
    mockPool.connect = jest.fn().mockResolvedValue(mockClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('strictTenantBoundary', () => {
    it('should pass when tenant ID matches user organization', async () => {
      await strictTenantBoundary(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should reject when no tenant ID is present', async () => {
      mockRequest.tenantId = undefined;

      await strictTenantBoundary(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Tenant context violation',
        })
      );
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should reject when user organization does not match tenant ID', async () => {
      mockRequest.user!.organizationId = 2;

      await strictTenantBoundary(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Access denied',
        })
      );
      expect(logger.warn).toHaveBeenCalledWith(
        'Tenant boundary violation attempt',
        expect.objectContaining({
          userOrganization: 2,
          requestedTenant: 1,
        })
      );
    });

    it('should reject when body contains mismatched organization ID', async () => {
      mockRequest.body = { organizationId: 2 };

      await strictTenantBoundary(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Organization ID in request does not match your tenant',
        })
      );
    });

    it('should allow when body organization ID matches tenant', async () => {
      mockRequest.body = { organizationId: 1 };

      await strictTenantBoundary(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });
  });

  describe('validateActiveTenant', () => {
    it('should pass when organization exists and is active', async () => {
      mockPool.query = jest.fn().mockResolvedValue({
        rows: [
          {
            id: 1,
            name: 'Test Organization',
            is_active: true,
            subscription_status: 'active',
          },
        ],
      });

      await validateActiveTenant(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect((mockRequest as any).organizationMeta).toEqual({
        id: 1,
        name: 'Test Organization',
        isActive: true,
        subscriptionStatus: 'active',
      });
    });

    it('should reject when organization does not exist', async () => {
      mockPool.query = jest.fn().mockResolvedValue({ rows: [] });

      await validateActiveTenant(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Organization not found',
        })
      );
    });

    it('should reject when organization is inactive', async () => {
      mockPool.query = jest.fn().mockResolvedValue({
        rows: [
          {
            id: 1,
            name: 'Inactive Org',
            is_active: false,
            subscription_status: 'suspended',
          },
        ],
      });

      await validateActiveTenant(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Organization inactive',
        })
      );
      expect(logger.warn).toHaveBeenCalledWith(
        'Access attempt to inactive organization',
        expect.any(Object)
      );
    });

    it('should handle database errors gracefully', async () => {
      mockPool.query = jest.fn().mockRejectedValue(new Error('Database error'));

      await validateActiveTenant(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('enforceRLS', () => {
    it('should set PostgreSQL session variables for RLS', async () => {
      await enforceRLS(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockPool.connect).toHaveBeenCalled();
      expect(mockClient.query).toHaveBeenCalledWith('SET LOCAL app.current_tenant_id = $1', [1]);
      expect(mockClient.query).toHaveBeenCalledWith('SET LOCAL app.current_user_id = $1', [
        'user-123',
      ]);
      expect(nextFunction).toHaveBeenCalled();
    });

    it('should release client on response finish', async () => {
      let finishCallback: Function | null = null;
      mockResponse.on = jest.fn((event, callback) => {
        if (event === 'finish') {
          finishCallback = callback;
        }
        return mockResponse;
      }) as any;

      await enforceRLS(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(finishCallback).toBeTruthy();
      finishCallback!();

      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should reject when tenant ID is missing', async () => {
      mockRequest.tenantId = undefined;

      await enforceRLS(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockPool.connect).not.toHaveBeenCalled();
    });

    it('should handle connection errors', async () => {
      mockPool.connect = jest.fn().mockRejectedValue(new Error('Connection failed'));

      await enforceRLS(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to enforce RLS',
        expect.objectContaining({
          tenantId: 1,
        })
      );
    });
  });

  describe('monitorTenantAccess', () => {
    it('should log tenant access and call next', async () => {
      await monitorTenantAccess(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(logger.debug).toHaveBeenCalledWith(
        'Tenant access',
        expect.objectContaining({
          tenantId: 1,
          userId: 'user-123',
          method: 'GET',
          path: '/api/employees',
        })
      );
      expect(nextFunction).toHaveBeenCalled();
    });

    it('should track access pattern in database', async () => {
      await monitorTenantAccess(mockRequest as Request, mockResponse as Response, nextFunction);

      // Wait for async tracking
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO tenant_access_logs'),
        expect.arrayContaining([
          1,
          'user-123',
          'test@example.com',
          'EMPLOYER',
          'GET',
          '/api/employees',
          '192.168.1.1',
          'Jest Test Agent',
          expect.any(Date),
        ])
      );
    });

    it('should handle tracking errors gracefully', async () => {
      mockPool.query = jest.fn().mockRejectedValue(new Error('Database error'));

      await monitorTenantAccess(mockRequest as Request, mockResponse as Response, nextFunction);

      // Should still call next despite error
      expect(nextFunction).toHaveBeenCalled();

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to insert tenant access log',
        expect.any(Object)
      );
    });
  });

  describe('validateResultTenant', () => {
    it('should return true for empty results', () => {
      const result = validateResultTenant([], 1);
      expect(result).toBe(true);
    });

    it('should return true when all results match tenant', () => {
      const results = [{ organization_id: 1 }, { organization_id: 1 }, { organization_id: 1 }];

      const result = validateResultTenant(results, 1);
      expect(result).toBe(true);
    });

    it('should return false and log error when results contain wrong tenant', () => {
      const results = [{ organization_id: 1 }, { organization_id: 2 }, { organization_id: 1 }];

      const result = validateResultTenant(results, 1);

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        'Tenant isolation breach detected in query results',
        expect.objectContaining({
          expectedTenantId: 1,
          invalidCount: 1,
          sampleInvalidTenantId: 2,
        })
      );
    });

    it('should use custom tenant field name', () => {
      const results = [{ tenant_id: 1 }, { tenant_id: 1 }];

      const result = validateResultTenant(results, 1, 'tenant_id');
      expect(result).toBe(true);
    });
  });

  describe('getTenantAccessStats', () => {
    it('should return tenant access statistics', async () => {
      mockPool.query = jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              total_requests: '150',
              unique_users: '10',
              unique_ips: '12',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { path: '/api/employees', count: '50' },
            { path: '/api/payroll', count: '30' },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ reason: 'Multiple IPs per user', count: '3' }],
        });

      const stats = await getTenantAccessStats(1, new Date('2024-01-01'), new Date('2024-01-31'));

      expect(stats).toEqual({
        totalRequests: 150,
        uniqueUsers: 10,
        uniqueIPs: 12,
        topPaths: [
          { path: '/api/employees', count: 50 },
          { path: '/api/payroll', count: 30 },
        ],
        suspiciousActivity: [{ reason: 'Multiple IPs per user', count: 3 }],
      });
    });
  });
});
