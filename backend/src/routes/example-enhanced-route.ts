/**
 * Example route demonstrating the enhanced security features from Issue #375
 * This file serves as a reference implementation for applying:
 * - Enhanced audit logging
 * - Advanced rate limiting
 * - Strengthened multi-tenant isolation
 */

import { Router } from 'express';
import { auditLoggerMiddleware, auditSensitiveOperation } from '../middleware/auditLogger.js';
import {
  comprehensiveTenantIsolation,
  strictTenantBoundary,
  validateActiveTenant,
} from '../middleware/enhancedTenantIsolation.js';
import {
  advancedRateLimitMiddleware,
  tieredOrganizationRateLimit,
  endpointRateLimit,
} from '../middleware/advancedRateLimiting.js';
import authenticateJWT from '../middlewares/auth.js';

const router = Router();

/**
 * EXAMPLE 1: Basic route with all enhancements
 * - Audit logging for all requests
 * - Organization-based rate limiting
 * - Full tenant isolation stack
 */
router.get(
  '/basic-example',
  auditLoggerMiddleware({ logRequestBody: true }),
  tieredOrganizationRateLimit(),
  authenticateJWT,
  comprehensiveTenantIsolation,
  async (req, res) => {
    // Your controller logic here
    res.json({
      message: 'This endpoint has enhanced security',
      organizationId: req.tenantId,
      userId: req.user?.id,
    });
  }
);

/**
 * EXAMPLE 2: High-security endpoint with custom rate limiting
 * - Strict rate limits
 * - Audit logs only errors
 * - Sensitive operation tracking
 */
router.post(
  '/sensitive-operation',
  auditLoggerMiddleware({ logOnlyErrors: false }),
  advancedRateLimitMiddleware({
    tier: 'strict',
    enableBypass: true,
    organizationBased: true,
  }),
  authenticateJWT,
  strictTenantBoundary,
  validateActiveTenant,
  auditSensitiveOperation('sensitive_data_access'),
  async (req, res) => {
    // Sensitive operation logic
    res.json({ success: true });
  }
);

/**
 * EXAMPLE 3: Public endpoint with IP-based rate limiting
 * - No authentication required
 * - IP-based rate limiting
 * - Basic audit logging
 */
router.get(
  '/public-data',
  auditLoggerMiddleware({
    logRequestBody: false,
    skipPaths: [/\/health/],
  }),
  advancedRateLimitMiddleware({
    tier: 'api',
    identifier: (req) => req.ip || 'unknown',
  }),
  async (req, res) => {
    // Public data logic
    res.json({ data: 'public information' });
  }
);

/**
 * EXAMPLE 4: Endpoint with custom rate limit rules
 * - Different limits for GET vs POST
 * - Bypass tokens enabled
 * - Dynamic limits based on organization tier
 */
router.use(
  '/custom-limits',
  endpointRateLimit({
    '.*/read$': { tier: 'data', methods: ['GET'] },
    '.*/write$': { tier: 'auth', methods: ['POST', 'PUT', 'PATCH'] },
    '.*/delete$': { tier: 'strict', methods: ['DELETE'] },
  })
);

router.get('/custom-limits/read', authenticateJWT, async (req, res) => {
  res.json({ message: 'Read operation with data tier limits' });
});

router.post('/custom-limits/write', authenticateJWT, async (req, res) => {
  res.json({ message: 'Write operation with auth tier limits' });
});

router.delete(
  '/custom-limits/delete',
  authenticateJWT,
  auditSensitiveOperation('delete_operation'),
  async (req, res) => {
    res.json({ message: 'Delete operation with strict tier limits' });
  }
);

/**
 * EXAMPLE 5: Admin-only endpoint with maximum security
 * - Comprehensive audit logging
 * - Strictest rate limits
 * - Role-based access control
 * - Full tenant isolation
 * - Sensitive operation tracking
 */
router.delete(
  '/admin/purge-data',
  auditLoggerMiddleware({
    logRequestBody: true,
    logResponseBody: true,
  }),
  advancedRateLimitMiddleware({
    tier: 'strict',
    enableBypass: false,
    organizationBased: true,
  }),
  authenticateJWT,
  comprehensiveTenantIsolation,
  auditSensitiveOperation('admin_purge_data'),
  async (req, res) => {
    // Check admin role
    if (req.user?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Admin operation logic here
    res.json({
      success: true,
      message: 'Data purge operation completed',
      auditTrail: 'All actions logged',
    });
  }
);

/**
 * EXAMPLE 6: Batch operation with adaptive rate limiting
 * - Adjusts limits based on system load
 * - Monitors tenant access patterns
 * - Comprehensive logging
 */
router.post(
  '/batch-process',
  auditLoggerMiddleware({ logRequestBody: true }),
  advancedRateLimitMiddleware({
    tier: 'data',
    enableDynamicLimits: true,
    organizationBased: true,
  }),
  authenticateJWT,
  comprehensiveTenantIsolation,
  async (req, res) => {
    const { items } = req.body;

    // Batch processing logic
    res.json({
      processed: items?.length || 0,
      organizationId: req.tenantId,
    });
  }
);

/**
 * EXAMPLE 7: Webhook endpoint with special handling
 * - Skips certain validations for webhooks
 * - Still maintains audit trail
 * - Custom identifier based on webhook source
 */
router.post(
  '/webhook/:source',
  auditLoggerMiddleware({
    logRequestBody: true,
    sensitiveFields: ['secret', 'token', 'signature'],
  }),
  advancedRateLimitMiddleware({
    tier: 'api',
    identifier: (req) => `webhook:${req.params.source}`,
    skip: (req) => req.headers['x-webhook-trusted'] === 'true',
  }),
  async (req, res) => {
    // Webhook processing logic
    res.json({ received: true });
  }
);

export default router;
