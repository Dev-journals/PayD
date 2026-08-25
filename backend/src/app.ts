import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './config/index.js';
import logger from './utils/logger.js';
import passport from './config/passport.js';
import { apiVersionMiddleware } from './middlewares/apiVersionMiddleware.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { auditLoggerMiddleware } from './middleware/auditLogger.js';
import { tieredOrganizationRateLimit } from './middleware/advancedRateLimiting.js';
import { rateLimitHeaders } from './middleware/rateLimitHeaders.js';
import { syncTenantFromUser } from './middleware/tenantContext.js';

// Feature Routes
import v1Routes from './routes/v1/index.js';
import authRoutes from './routes/authRoutes.js';
import webhookRoutes from './routes/webhook.routes.js';

// Upstream Routes
import payrollRoutes from './routes/payroll.routes.js';
import employeeRoutes from './routes/employeeRoutes.js';
import assetRoutes from './routes/assetRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import searchRoutes from './routes/searchRoutes.js';
import contractRoutes from './routes/contractRoutes.js';

// My Routes
import scheduleRoutes from './routes/scheduleRoutes.js';
import contractEventRoutes from './routes/contractEventRoutes.js';
import certificateRoutes from './routes/certificateRoutes.js';
import cashFlowForecastRoutes from './routes/cashFlowForecastRoutes.js';
import { HealthController } from './controllers/healthController.js';

// Part 49 — admin, audit integrity, per-tenant rate limits, quotas
import adminRoutes from './routes/adminRoutes.js';
import tenantUsageRoutes from './routes/tenantUsageRoutes.js';

// Part 48 — request auditing, rate limiting, tenant security
import { requestAuditLoggerMiddleware } from './middleware/requestAuditLogger.js';
import { organizationRateLimiter } from './middleware/organizationRateLimiter.js';
import { detectSqlInjection } from './middleware/tenantSecurityMonitor.js';

// Part 45 — enhanced audit analytics, smart rate limiting, tenant security guard
import auditAnalyticsRoutes from './routes/auditAnalyticsRoutes.js';
import smartRateLimitRoutes from './routes/smartRateLimitRoutes.js';
import tenantSecurityRoutes from './routes/tenantSecurityRoutes.js';
import { enhancedAuditMiddleware } from './middleware/enhancedAuditAnalytics.js';
import { smartRateLimitMiddleware } from './middleware/smartRateLimiter.js';
import { tenantSecurityGuardMiddleware } from './middleware/tenantSecurityGuard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middleware — request ID first for correlation across all layers
app.use(requestIdMiddleware);

// Standard X-RateLimit-* response headers on every response, normalized from
// whichever rate limiter (tiered/advanced, organization, or smart) ran for
// this request. Mounted first so the res.json/res.send hook is installed
// before any handler — including error/404 paths — can respond.
app.use(
  rateLimitHeaders({
    routeOverrides: {
      '/auth': { limit: 20 },
      '/api/auth': { limit: 20 },
    },
  })
);

// Global security headers via helmet with stricter CSP
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  })
);
app.use(cors());

// Attach request ID to morgan logs for end-to-end traceability
morgan.token('request-id', (req) => (req as any).requestId || '-');
app.use(
  morgan(
    ':method :url :status :res[content-length] - :response-time ms request-id=:request-id'
  )
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(passport.initialize());

// Global audit logging — records every API request with sanitization
app.use(
  auditLoggerMiddleware({
    logRequestBody: true,
    logResponseBody: false,
    sensitiveFields: ['password', 'token', 'secret', 'apiKey', 'privateKey', 'totp_secret'],
    skipPaths: [/^\/health/, /^\/metrics/, /^\/\.well-known/],
    logOnlyErrors: false,
  })
);

// Global rate limiting — organization-tier based, always on
app.use(
  tieredOrganizationRateLimit({
    enableBypass: true,
    enableDynamicLimits: true,
  })
);

// Global tenant context sync — sets req.tenantId from JWT user when available
// Must run before any authenticated routes
app.use(syncTenantFromUser);

// Serve stellar.toml for SEP-0001
app.get('/.well-known/stellar.toml', (req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.sendFile(path.join(__dirname, '../.well-known/stellar.toml'));
});

// Health check endpoints (public / unauthenticated)
app.get('/health', HealthController.getHealthStatus);
app.get('/health/live', HealthController.getLiveness);

// Middleware for versioning
app.use(apiVersionMiddleware);

// Part 48 — request audit logging, rate limiting, SQL injection detection
app.use('/api', requestAuditLoggerMiddleware());
app.use('/api', organizationRateLimiter());
app.use('/api', detectSqlInjection());

// Part 45 — enhanced audit analytics, smart rate limiting, tenant security guard
app.use('/api', enhancedAuditMiddleware({ trackPerformance: true, trackErrors: true }));
app.use('/api', smartRateLimitMiddleware({ organizationBased: true }));
app.use('/api', tenantSecurityGuardMiddleware({ detectAnomalies: true }));

// Feature / PR specific routes
app.use('/auth', authRoutes);
app.use('/api/v1', v1Routes);
app.use('/webhooks', webhookRoutes);

// Upstream / Base routes
app.use('/api/auth', authRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/search', searchRoutes);
app.use('/api', contractRoutes);

// Feature specific routes
app.use('/api/schedules', scheduleRoutes);
app.use('/api/events', contractEventRoutes);
app.use('/api/certificates', certificateRoutes);
app.use('/api/cash-flow', cashFlowForecastRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/usage', tenantUsageRoutes);

// Part 45 — enhanced audit analytics, smart rate limiting, tenant security guard
app.use('/api/audit-analytics', auditAnalyticsRoutes);
app.use('/api/smart-rate-limit', smartRateLimitRoutes);
app.use('/api/tenant-security', tenantSecurityRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    path: req.path,
    requestId: (req as any).requestId,
  });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', { err, requestId: (req as any).requestId });
  res.status(500).json({
    error: 'Internal Server Error',
    message: config.nodeEnv === 'development' ? err.message : 'An error occurred',
    requestId: (req as any).requestId,
  });
});

export default app;
