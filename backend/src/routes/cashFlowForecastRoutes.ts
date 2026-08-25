import { Router } from 'express';
import { CashFlowForecastController } from '../controllers/cashFlowForecastController.js';
import { authenticateJWT } from '../middlewares/auth.js';
import { syncTenantFromUser } from '../middleware/tenantContext.js';
import { strictTenantBoundary, logTenantAccess } from '../middleware/enhancedTenantIsolation.js';

const router = Router();

router.use(authenticateJWT);
router.use(syncTenantFromUser);
router.use(strictTenantBoundary);
router.use(logTenantAccess);

/**
 * @route GET /api/cash-flow/forecast
 * @desc Generate comprehensive cash flow forecast
 * @query forecastDays - Number of days to forecast (default: 90, max: 365)
 * @query distributionAccount - Stellar distribution account public key (required)
 * @query assetIssuer - ORGUSD asset issuer public key (required)
 * @access Private (requires authentication)
 */
router.get('/forecast', CashFlowForecastController.getForecast);

/**
 * @route GET /api/cash-flow/historical
 * @desc Get historical payroll data analysis
 * @query monthsBack - Number of months to analyze (default: 6, max: 24)
 * @access Private (requires authentication)
 */
router.get('/historical', CashFlowForecastController.getHistorical);

/**
 * @route GET /api/cash-flow/projections
 * @desc Get upcoming scheduled payroll projections
 * @query forecastDays - Number of days to project (default: 90, max: 365)
 * @access Private (requires authentication)
 */
router.get('/projections', CashFlowForecastController.getProjections);

/**
 * @route GET /api/cash-flow/alerts
 * @desc Get budget alerts for the organization
 * @query forecastDays - Number of days to forecast (default: 90, max: 365)
 * @query distributionAccount - Stellar distribution account public key (required)
 * @query assetIssuer - ORGUSD asset issuer public key (required)
 * @access Private (requires authentication)
 */
router.get('/alerts', CashFlowForecastController.getAlerts);

export default router;
