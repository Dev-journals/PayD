import { Router, Request, Response, NextFunction } from 'express';
import { employeeController } from '../controllers/employeeController.js';
import authenticateJWT from '../middlewares/auth.js';
import { authorizeRoles, isolateOrganization } from '../middlewares/rbac.js';
import { tenantQuotaService, QuotaExceededError } from '../services/tenantQuotaService.js';
import { auditSensitiveOperation } from '../middleware/auditLogger.js';
import { syncTenantFromUser } from '../middleware/tenantContext.js';
import {
  strictTenantBoundary,
  validateActiveTenant,
  logTenantAccess,
} from '../middleware/enhancedTenantIsolation.js';

async function enforceEmployeeQuota(req: Request, res: Response, next: NextFunction): Promise<void> {
  const orgId = req.tenantId ?? req.user?.organizationId;
  if (!orgId) { next(); return; }
  try {
    await tenantQuotaService.assertEmployeeQuota(orgId);
    next();
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      res.status(429).json({
        error: 'Quota exceeded',
        resource: err.resource,
        current: err.current,
        limit: err.limit,
        message: `Employee quota reached (${err.current}/${err.limit}). Contact support to increase your limit.`,
      });
    } else {
      next(err);
    }
  }
}

function enhancedIsolation(): any[] {
  return [syncTenantFromUser, strictTenantBoundary, validateActiveTenant, logTenantAccess];
}

const router = Router();

// Apply authentication to all employee routes
router.use(authenticateJWT);

// Enhanced tenant isolation — runs after auth (req.user is available)
router.use(...enhancedIsolation());

/**
 * @route POST /api/employees
 * @desc Create a new employee
 */
router.post(
  '/',
  authorizeRoles('EMPLOYER'),
  isolateOrganization,
  enforceEmployeeQuota,
  employeeController.create.bind(employeeController)
);

/**
 * @route GET /api/employees
 * @desc Get all employees with pagination and filtering
 */
router.get(
  '/',
  authorizeRoles('EMPLOYER'),
  isolateOrganization,
  employeeController.getAll.bind(employeeController)
);

/**
 * @route GET /api/employees/:id
 * @desc Get a single employee by ID
 */
router.get(
  '/:id',
  authorizeRoles('EMPLOYER', 'EMPLOYEE'),
  isolateOrganization,
  employeeController.getOne.bind(employeeController)
);

/**
 * @route PATCH /api/employees/:id
 * @desc Update an employee
 */
router.patch(
  '/:id',
  authorizeRoles('EMPLOYER'),
  isolateOrganization,
  employeeController.update.bind(employeeController)
);

/**
 * @route DELETE /api/employees/:id
 * @desc Soft delete an employee (sensitive operation — fully audited)
 */
router.delete(
  '/:id',
  authorizeRoles('EMPLOYER'),
  isolateOrganization,
  auditSensitiveOperation('employee_delete'),
  employeeController.delete.bind(employeeController)
);

/**
 * @route POST /api/employees/bulk-import
 * @desc Bulk import employees from CSV
 */
import { bulkImportController } from '../controllers/bulkImportController.js';
router.post(
  '/bulk-import',
  authorizeRoles('EMPLOYER'),
  isolateOrganization,
  bulkImportController.import.bind(bulkImportController)
);

export default router;
