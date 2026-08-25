import { Router, Request, Response, NextFunction } from 'express';
import { BenefitsController } from '../controllers/benefitsController.js';
import { authenticateJWT } from '../middlewares/auth.js';
import { authorizeRoles, isolateOrganization } from '../middlewares/rbac.js';
import { setTenantContext } from '../middleware/tenantContext.js';

const router = Router();

router.use(authenticateJWT);
router.use(isolateOrganization);

const setTenantFromJwt = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user?.organizationId) {
    return res.status(400).json({ error: 'Missing organizationId in token' });
  }
  (req as any).tenantId = req.user.organizationId;
  return next();
};

// Benefit Plans
router.post(
  '/organizations/:organizationId/plans',
  authorizeRoles('EMPLOYER'),
  setTenantFromJwt,
  setTenantContext,
  BenefitsController.createBenefitPlan
);

router.get(
  '/organizations/:organizationId/plans',
  authorizeRoles('EMPLOYER'),
  setTenantFromJwt,
  setTenantContext,
  BenefitsController.listBenefitPlans
);

router.put(
  '/organizations/:organizationId/plans/:id',
  authorizeRoles('EMPLOYER'),
  setTenantFromJwt,
  setTenantContext,
  BenefitsController.updateBenefitPlan
);

router.delete(
  '/organizations/:organizationId/plans/:id',
  authorizeRoles('EMPLOYER'),
  setTenantFromJwt,
  setTenantContext,
  BenefitsController.deleteBenefitPlan
);

// Employee benefit enrollments
router.post(
  '/organizations/:organizationId/enrollments',
  authorizeRoles('EMPLOYER'),
  setTenantFromJwt,
  setTenantContext,
  BenefitsController.upsertEmployeeEnrollment
);

router.get(
  '/organizations/:organizationId/employees/:employeeId/enrollments',
  authorizeRoles('EMPLOYER'),
  setTenantFromJwt,
  setTenantContext,
  BenefitsController.listEmployeeEnrollments
);

// Deduction rules
router.post(
  '/organizations/:organizationId/deduction-rules',
  authorizeRoles('EMPLOYER'),
  setTenantFromJwt,
  setTenantContext,
  BenefitsController.createDeductionRule
);

router.get(
  '/organizations/:organizationId/deduction-rules',
  authorizeRoles('EMPLOYER'),
  setTenantFromJwt,
  setTenantContext,
  BenefitsController.listDeductionRules
);

router.put(
  '/organizations/:organizationId/deduction-rules/:id',
  authorizeRoles('EMPLOYER'),
  setTenantFromJwt,
  setTenantContext,
  BenefitsController.updateDeductionRule
);

router.delete(
  '/organizations/:organizationId/deduction-rules/:id',
  authorizeRoles('EMPLOYER'),
  setTenantFromJwt,
  setTenantContext,
  BenefitsController.deleteDeductionRule
);

// Draft payslip (gross vs net)
router.post(
  '/organizations/:organizationId/draft-payslips',
  authorizeRoles('EMPLOYER'),
  setTenantFromJwt,
  setTenantContext,
  BenefitsController.generateDraftPayslip
);

// Employee view: deductions breakdown for the authenticated wallet
router.get('/me/deductions', authorizeRoles('EMPLOYEE'), setTenantFromJwt, setTenantContext, BenefitsController.getMyDeductions);

export default router;
