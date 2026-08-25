import { Request, Response, NextFunction } from 'express';
import {
  strictTenantBoundaryCheck,
  validateActiveTenant,
  monitorTenantAccessPattern,
  detectSqlInjection,
  comprehensiveTenantSecurity,
  logSecurityEvent,
  getSecurityEvents,
  resolveSecurityEvent,
  detectAnomalousAccess,
  getTenantAccessStats,
} from '../tenantSecurityMonitor.js';
import pool from '../../db/index.js';
import logger from '../../utils/logger.js';

jest.mock('../../db/index.js');
jest.mock('../../utils/logger.js');

describe('TenantSecurityMonitor', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;
  let mockPool: jest.Mocked<typeof pool>;

  beforeEach(() => {
    mockRequest = {
      method: 'GET',
      path: '/api/employees',
      body: {},
      query: {},
      params: {},
      headers: {
        'user-agent': 'Jest Test Agent',
      },
      user: {
        organizationId: 1,
        userId: 10,
        id: 10,
      } as any,
      socket: { remoteAddress: '127.0.0.1' } as any,
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      headersSent: false,
    } as any;

    nextFunction = jest.fn();
    mockPool = pool as jest.Mocked<typeof pool>;
    mockPool.query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ===================================================================
  // strictTenantBoundaryCheck
  // ===================================================================
  describe('strictTenantBoundaryCheck', () => {
    it('should call next() when no organization context exists', async () => {
      mockRequest.user = {} as any;
      mockRequest.query = {};
      mockRequest.params = {};

      const middleware = strictTenantBoundaryCheck();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should call next() when accessing own organization data', async () => {
      mockRequest.user = { organizationId: 1 } as any;
      mockRequest.params = { organizationId: '1' };

      const middleware = strictTenantBoundaryCheck();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should block cross-tenant access and return 403', async () => {
      mockRequest.user = { organizationId: 1, userId: 10 } as any;
      mockRequest.params = { organizationId: '2' };

      const middleware = strictTenantBoundaryCheck();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Access denied',
        })
      );
    });

    it('should log security event on cross-tenant attempt', async () => {
      mockRequest.user = { organizationId: 1, userId: 10 } as any;
      mockRequest.params = { organizationId: '2' };

      const middleware = strictTenantBoundaryCheck();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      // logSecurityEvent inserts into security_events
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO security_events'),
        expect.arrayContaining([1, 10, 'cross_tenant_access_attempt', 'high'])
      );
    });

    it('should log tenant access denial on cross-tenant attempt', async () => {
      mockRequest.user = { organizationId: 1, userId: 10 } as any;
      mockRequest.params = { organizationId: '2' };

      const middleware = strictTenantBoundaryCheck();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      // logTenantAccess inserts into tenant_access_monitoring
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO tenant_access_monitoring'),
        expect.arrayContaining([1, 10, 2])
      );
    });

    it('should detect cross-tenant access from query parameters', async () => {
      mockRequest.user = { organizationId: 1, userId: 10 } as any;
      mockRequest.params = {};
      mockRequest.query = { organizationId: '5' };

      const middleware = strictTenantBoundaryCheck();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(403);
    });
  });

  // ===================================================================
  // validateActiveTenant
  // ===================================================================
  describe('validateActiveTenant', () => {
    it('should call next() when no organization context exists', async () => {
      mockRequest.user = {} as any;
      mockRequest.query = {};
      mockRequest.params = {};

      const middleware = validateActiveTenant();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it('should call next() when organization is active', async () => {
      mockPool.query = jest.fn().mockResolvedValue({
        rows: [{ id: 1, name: 'TestOrg', is_active: true, status: 'active' }],
      });

      const middleware = validateActiveTenant();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect((mockRequest as any).organization).toBeDefined();
    });

    it('should return 404 when organization does not exist', async () => {
      mockPool.query = jest.fn().mockResolvedValue({ rows: [] });

      const middleware = validateActiveTenant();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Organization not found',
        })
      );
    });

    it('should return 403 when organization is inactive', async () => {
      mockPool.query = jest.fn().mockResolvedValue({
        rows: [{ id: 1, name: 'TestOrg', is_active: false, status: 'inactive' }],
      });

      const middleware = validateActiveTenant();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(403);
    });

    it('should return 403 when organization is suspended', async () => {
      mockPool.query = jest.fn().mockResolvedValue({
        rows: [{ id: 1, name: 'TestOrg', is_active: true, status: 'suspended' }],
      });

      const middleware = validateActiveTenant();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(403);
    });

    it('should return 500 on database error', async () => {
      mockPool.query = jest.fn().mockRejectedValue(new Error('DB connection failed'));

      const middleware = validateActiveTenant();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(logger.error).toHaveBeenCalledWith(
        'Error validating tenant:',
        expect.any(Error)
      );
    });
  });

  // ===================================================================
  // monitorTenantAccessPattern
  // ===================================================================
  describe('monitorTenantAccessPattern', () => {
    it('should call next() immediately without blocking', async () => {
      const middleware = monitorTenantAccessPattern();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it('should call next() and skip logging when no organization ID', async () => {
      mockRequest.user = {} as any;

      const middleware = monitorTenantAccessPattern();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it('should classify DELETE as delete access type', async () => {
      mockRequest.method = 'DELETE';

      const middleware = monitorTenantAccessPattern();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      // Wait for fire-and-forget
      await new Promise((r) => setTimeout(r, 10));

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO tenant_access_monitoring'),
        expect.arrayContaining(['delete'])
      );
    });

    it('should classify POST as write access type', async () => {
      mockRequest.method = 'POST';

      const middleware = monitorTenantAccessPattern();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      await new Promise((r) => setTimeout(r, 10));

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO tenant_access_monitoring'),
        expect.arrayContaining(['write'])
      );
    });

    it('should classify admin paths as admin access type', async () => {
      mockRequest.method = 'GET';
      mockRequest.path = '/api/admin/settings';

      const middleware = monitorTenantAccessPattern();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      await new Promise((r) => setTimeout(r, 10));

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO tenant_access_monitoring'),
        expect.arrayContaining(['admin'])
      );
    });
  });

  // ===================================================================
  // detectSqlInjection
  // ===================================================================
  describe('detectSqlInjection', () => {
    it('should call next() for clean requests', async () => {
      mockRequest.query = { name: 'John Doe', page: '1' };
      mockRequest.body = { email: 'test@example.com' };

      const middleware = detectSqlInjection();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it('should block SQL injection in query parameters', async () => {
      mockRequest.query = { search: "'; DROP TABLE users; --" };

      const middleware = detectSqlInjection();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Invalid request',
        })
      );
    });

    it('should block UNION SELECT injection', async () => {
      mockRequest.query = { id: '1 UNION SELECT * FROM users' };

      const middleware = detectSqlInjection();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(400);
    });

    it('should block OR 1=1 injection', async () => {
      mockRequest.query = { filter: "admin' OR 1=1" };

      const middleware = detectSqlInjection();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(400);
    });

    it('should block SQL injection in request body', async () => {
      mockRequest.body = { username: "admin'; DELETE FROM users; --" };

      const middleware = detectSqlInjection();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(400);
    });

    it('should block SQL injection in nested body objects', async () => {
      mockRequest.body = {
        profile: {
          bio: "Normal text",
          website: "http://example.com'; DROP TABLE users; --",
        },
      };

      const middleware = detectSqlInjection();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(400);
    });

    it('should log critical security event on SQL injection attempt', async () => {
      mockRequest.query = { search: "1 UNION SELECT password FROM users" };

      const middleware = detectSqlInjection();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO security_events'),
        expect.arrayContaining(['sql_injection_attempt', 'critical'])
      );
    });
  });

  // ===================================================================
  // logSecurityEvent
  // ===================================================================
  describe('logSecurityEvent', () => {
    it('should insert event into security_events table', async () => {
      await logSecurityEvent(
        1,
        10,
        'unauthorized_access_attempt',
        'high',
        'Test security event',
        '192.168.1.1',
        'TestAgent',
        { detail: 'test' }
      );

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO security_events'),
        [
          1,
          10,
          'unauthorized_access_attempt',
          'high',
          'Test security event',
          '192.168.1.1',
          'TestAgent',
          JSON.stringify({ detail: 'test' }),
        ]
      );
    });

    it('should handle null metadata', async () => {
      await logSecurityEvent(1, 10, 'brute_force_attempt', 'medium', 'Brute force');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO security_events'),
        expect.arrayContaining([null]) // null metadata
      );
    });

    it('should not throw on database failure', async () => {
      mockPool.query = jest.fn().mockRejectedValue(new Error('DB error'));

      await expect(
        logSecurityEvent(1, 10, 'invalid_token', 'low', 'Invalid token')
      ).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to log security event:',
        expect.any(Error)
      );
    });
  });

  // ===================================================================
  // getSecurityEvents
  // ===================================================================
  describe('getSecurityEvents', () => {
    it('should query security events by organization', async () => {
      mockPool.query = jest.fn().mockResolvedValue({
        rows: [{ id: 1, event_type: 'brute_force_attempt', severity: 'high' }],
      });

      const events = await getSecurityEvents(1);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('organization_id = $1'),
        expect.arrayContaining([1])
      );
      expect(events).toHaveLength(1);
    });

    it('should filter by severity when provided', async () => {
      mockPool.query = jest.fn().mockResolvedValue({ rows: [] });

      await getSecurityEvents(1, 'critical');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('severity = $2'),
        expect.arrayContaining([1, 'critical'])
      );
    });

    it('should filter by resolved status when provided', async () => {
      mockPool.query = jest.fn().mockResolvedValue({ rows: [] });

      await getSecurityEvents(1, undefined, false);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('resolved = $2'),
        expect.arrayContaining([1, false])
      );
    });

    it('should respect the limit parameter', async () => {
      mockPool.query = jest.fn().mockResolvedValue({ rows: [] });

      await getSecurityEvents(1, undefined, undefined, 50);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        expect.arrayContaining([50])
      );
    });
  });

  // ===================================================================
  // resolveSecurityEvent
  // ===================================================================
  describe('resolveSecurityEvent', () => {
    it('should update security event as resolved', async () => {
      mockPool.query = jest.fn().mockResolvedValue({ rowCount: 1 });

      const result = await resolveSecurityEvent(42, 10);

      expect(result).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE security_events'),
        [42, 10]
      );
    });

    it('should return false when event not found', async () => {
      mockPool.query = jest.fn().mockResolvedValue({ rowCount: 0 });

      const result = await resolveSecurityEvent(999, 10);

      expect(result).toBe(false);
    });
  });

  // ===================================================================
  // detectAnomalousAccess
  // ===================================================================
  describe('detectAnomalousAccess', () => {
    it('should detect users with many distinct IPs', async () => {
      mockPool.query = jest.fn().mockResolvedValue({
        rows: [
          { user_id: 10, distinct_ips: 5, distinct_resources: 3, total_accesses: 150, failed_accesses: 2 },
        ],
      });

      const anomalies = await detectAnomalousAccess(1, 60);

      expect(anomalies).toHaveLength(1);
      expect(anomalies[0].distinct_ips).toBe(5);
    });

    it('should use default lookback of 60 minutes', async () => {
      mockPool.query = jest.fn().mockResolvedValue({ rows: [] });

      await detectAnomalousAccess(1);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("60 minutes"),
        [1]
      );
    });
  });

  // ===================================================================
  // getTenantAccessStats
  // ===================================================================
  describe('getTenantAccessStats', () => {
    it('should return aggregated access statistics', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      mockPool.query = jest.fn().mockResolvedValue({
        rows: [
          {
            total_accesses: '200',
            unique_users: '5',
            unique_ips: '10',
            access_type: 'read',
            resource_type: 'employees',
            denied_accesses: '2',
          },
        ],
      });

      const stats = await getTenantAccessStats(1, startDate, endDate);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('tenant_access_monitoring'),
        [1, startDate, endDate]
      );
      expect(stats).toHaveLength(1);
      expect(stats[0].total_accesses).toBe('200');
    });
  });

  // ===================================================================
  // comprehensiveTenantSecurity
  // ===================================================================
  describe('comprehensiveTenantSecurity', () => {
    it('should execute the full middleware chain on valid request', async () => {
      // Active tenant query
      mockPool.query = jest.fn().mockResolvedValue({
        rows: [{ id: 1, name: 'TestOrg', is_active: true, status: 'active' }],
      });

      // No cross-tenant access, no SQL injection
      mockRequest.user = { organizationId: 1, userId: 10 } as any;
      mockRequest.params = {};
      mockRequest.query = { name: 'valid-search' };
      mockRequest.body = { field: 'value' };

      const middleware = comprehensiveTenantSecurity();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it('should stop chain on cross-tenant access attempt', async () => {
      mockRequest.user = { organizationId: 1, userId: 10 } as any;
      mockRequest.params = { organizationId: '2' };

      // Need to simulate that res.headersSent becomes true after status() is called
      const realStatus = jest.fn(() => {
        (mockResponse as any).headersSent = true;
        return mockResponse;
      });
      mockResponse.status = realStatus;

      const middleware = comprehensiveTenantSecurity();
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      // next() should not be called since boundary check failed
      expect(nextFunction).not.toHaveBeenCalled();
      expect(realStatus).toHaveBeenCalledWith(403);
    });
  });
});
