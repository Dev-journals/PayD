import { Request, Response, NextFunction } from 'express';
import {
  enhancedAuditMiddleware,
  trackEndpointPerformance,
  trackSlowRequests,
  trackRequestPatterns,
} from '../enhancedAuditAnalytics.js';
import { auditAnalyticsService } from '../../services/auditAnalyticsService.js';
import logger from '../../utils/logger.js';

jest.mock('../../services/auditAnalyticsService.js');
jest.mock('../../utils/logger.js');

describe('Enhanced Audit Analytics Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    mockRequest = {
      method: 'POST',
      path: '/api/employees',
      body: { name: 'John Doe' },
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
          setTimeout(callback, 0);
        }
        return mockResponse;
      }),
    } as any;

    nextFunction = jest.fn();
    (auditAnalyticsService.recordMetric as jest.Mock) = jest.fn().mockResolvedValue(undefined);
    (auditAnalyticsService.getCachedAggregation as jest.Mock) = jest.fn().mockResolvedValue({});
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('enhancedAuditMiddleware', () => {
    it('should track performance metrics', async () => {
      const middleware = enhancedAuditMiddleware({ trackPerformance: true });

      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(auditAnalyticsService.recordMetric).toHaveBeenCalledWith(
        expect.objectContaining({
          metricType: 'request_duration',
          dimension: 'method',
          dimensionValue: 'POST',
        })
      );
    });

    it('should track errors when status code >= 400', async () => {
      mockResponse.statusCode = 500;
      const middleware = enhancedAuditMiddleware({ trackErrors: true });

      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(auditAnalyticsService.recordMetric).toHaveBeenCalledWith(
        expect.objectContaining({
          metricType: 'error_count',
          dimension: 'status_code',
          dimensionValue: '500',
        })
      );
    });

    it('should skip logging for excluded paths', async () => {
      mockRequest.path = '/health';
      const middleware = enhancedAuditMiddleware({
        skipPaths: [/^\/health/],
      });

      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(auditAnalyticsService.recordMetric).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      (auditAnalyticsService.recordMetric as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );

      const middleware = enhancedAuditMiddleware();
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to record enhanced audit metric',
        expect.any(Object)
      );
    });
  });

  describe('trackEndpointPerformance', () => {
    it('should cache endpoint performance data', async () => {
      const middleware = trackEndpointPerformance();

      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(auditAnalyticsService.getCachedAggregation).toHaveBeenCalledWith(
        1,
        'endpoint_performance',
        'POST:/api/employees',
        expect.any(Function),
        5
      );
    });
  });

  describe('trackSlowRequests', () => {
    it('should track requests exceeding threshold', async () => {
      const middleware = trackSlowRequests(100);

      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      // Wait for request to complete
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(auditAnalyticsService.recordMetric).toHaveBeenCalledWith(
        expect.objectContaining({
          metricType: 'slow_request',
          dimension: 'threshold',
          dimensionValue: '100',
        })
      );
    });

    it('should not track requests under threshold', async () => {
      const middleware = trackSlowRequests(1000);

      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(auditAnalyticsService.recordMetric).not.toHaveBeenCalledWith(
        expect.objectContaining({
          metricType: 'slow_request',
        })
      );
    });
  });

  describe('trackRequestPatterns', () => {
    it('should track method distribution', async () => {
      const middleware = trackRequestPatterns();

      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(auditAnalyticsService.recordMetric).toHaveBeenCalledWith(
        expect.objectContaining({
          metricType: 'method_distribution',
          dimension: 'method',
          dimensionValue: 'POST',
        })
      );
    });

    it('should track resource access', async () => {
      const middleware = trackRequestPatterns();

      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(auditAnalyticsService.recordMetric).toHaveBeenCalledWith(
        expect.objectContaining({
          metricType: 'resource_access',
          dimension: 'resource',
          dimensionValue: 'employees',
        })
      );
    });
  });
});