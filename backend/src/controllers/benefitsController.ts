import { Request, Response } from 'express';
import { z } from 'zod';
import {
  benefitPlanSchema,
  updateBenefitPlanSchema,
  deductionRuleSchema,
  updateDeductionRuleSchema,
  employeeBenefitEnrollmentSchema,
  draftPayslipSchema,
} from '../schemas/benefitsSchema.js';
import { benefitsService } from '../services/benefitsService.js';
import pool from '../config/database.js';

export class BenefitsController {
  static async createBenefitPlan(req: Request, res: Response) {
    try {
      const organizationId = Number(req.params.organizationId);
      const parsed = benefitPlanSchema.parse({ ...req.body, organization_id: organizationId });
      const plan = await benefitsService.createBenefitPlan(parsed);
      res.status(201).json({ success: true, data: plan });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Validation Error', details: error.issues });
      }
      res.status(500).json({ error: 'Failed to create benefit plan', message: (error as Error).message });
    }
  }

  static async listBenefitPlans(req: Request, res: Response) {
    try {
      const organizationId = Number(req.params.organizationId);
      const includeInactive = req.query.includeInactive === 'true';
      const plans = await benefitsService.listBenefitPlans(organizationId, includeInactive);
      res.json({ success: true, data: plans, count: plans.length });
    } catch (error) {
      res.status(500).json({ error: 'Failed to list benefit plans', message: (error as Error).message });
    }
  }

  static async updateBenefitPlan(req: Request, res: Response) {
    try {
      const id = Number(req.params.id);
      const updates = updateBenefitPlanSchema.parse(req.body);
      const plan = await benefitsService.updateBenefitPlan(id, updates as any);
      if (!plan) return res.status(404).json({ error: 'Benefit plan not found' });
      res.json({ success: true, data: plan });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Validation Error', details: error.issues });
      }
      res.status(500).json({ error: 'Failed to update benefit plan', message: (error as Error).message });
    }
  }

  static async deleteBenefitPlan(req: Request, res: Response) {
    try {
      const id = Number(req.params.id);
      const ok = await benefitsService.deleteBenefitPlan(id);
      if (!ok) return res.status(404).json({ error: 'Benefit plan not found' });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete benefit plan', message: (error as Error).message });
    }
  }

  static async upsertEmployeeEnrollment(req: Request, res: Response) {
    try {
      const organizationId = Number(req.params.organizationId);
      const parsed = employeeBenefitEnrollmentSchema.parse({
        ...req.body,
        organization_id: organizationId,
      });
      const enrollment = await benefitsService.upsertEmployeeEnrollment(parsed);
      res.status(201).json({ success: true, data: enrollment });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Validation Error', details: error.issues });
      }
      res.status(500).json({ error: 'Failed to upsert enrollment', message: (error as Error).message });
    }
  }

  static async listEmployeeEnrollments(req: Request, res: Response) {
    try {
      const organizationId = Number(req.params.organizationId);
      const employeeId = Number(req.params.employeeId);
      const data = await benefitsService.listEmployeeEnrollments(organizationId, employeeId);
      res.json({ success: true, data, count: data.length });
    } catch (error) {
      res.status(500).json({ error: 'Failed to list enrollments', message: (error as Error).message });
    }
  }

  static async createDeductionRule(req: Request, res: Response) {
    try {
      const organizationId = Number(req.params.organizationId);
      const parsed = deductionRuleSchema.parse({ ...req.body, organization_id: organizationId });
      const rule = await benefitsService.createDeductionRule(parsed);
      res.status(201).json({ success: true, data: rule });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Validation Error', details: error.issues });
      }
      res.status(500).json({ error: 'Failed to create deduction rule', message: (error as Error).message });
    }
  }

  static async listDeductionRules(req: Request, res: Response) {
    try {
      const organizationId = Number(req.params.organizationId);
      const includeInactive = req.query.includeInactive === 'true';
      const rules = await benefitsService.listDeductionRules(organizationId, includeInactive);
      res.json({ success: true, data: rules, count: rules.length });
    } catch (error) {
      res.status(500).json({ error: 'Failed to list deduction rules', message: (error as Error).message });
    }
  }

  static async updateDeductionRule(req: Request, res: Response) {
    try {
      const id = Number(req.params.id);
      const updates = updateDeductionRuleSchema.parse(req.body);
      const rule = await benefitsService.updateDeductionRule(id, updates as any);
      if (!rule) return res.status(404).json({ error: 'Deduction rule not found' });
      res.json({ success: true, data: rule });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Validation Error', details: error.issues });
      }
      res.status(500).json({ error: 'Failed to update deduction rule', message: (error as Error).message });
    }
  }

  static async deleteDeductionRule(req: Request, res: Response) {
    try {
      const id = Number(req.params.id);
      const ok = await benefitsService.deleteDeductionRule(id);
      if (!ok) return res.status(404).json({ error: 'Deduction rule not found' });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete deduction rule', message: (error as Error).message });
    }
  }

  static async generateDraftPayslip(req: Request, res: Response) {
    try {
      const organizationId = Number(req.params.organizationId);
      const parsed = draftPayslipSchema.parse({ ...req.body, organization_id: organizationId });
      const draft = await benefitsService.generateDraftPayslip(parsed);
      res.json({ success: true, data: draft });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Validation Error', details: error.issues });
      }
      res.status(500).json({ error: 'Failed to generate draft payslip', message: (error as Error).message });
    }
  }

  static async getMyDeductions(req: Request, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'User not authenticated' });
      }
      if (!req.user.organizationId) {
        return res.status(400).json({ error: 'Missing organization for user' });
      }

      const wallet = req.user.walletAddress;
      const orgId = req.user.organizationId;

      const employeeLookup = await pool.query(
        `SELECT id FROM employees WHERE organization_id = $1 AND wallet_address = $2 AND deleted_at IS NULL LIMIT 1`,
        [orgId, wallet]
      );

      const employeeId = employeeLookup.rows[0]?.id;
      if (!employeeId) {
        return res.status(404).json({ error: 'Employee not found for current wallet' });
      }

      const draft = await benefitsService.generateDraftPayslip({
        organization_id: orgId,
        employee_id: employeeId,
      });

      res.json({ success: true, data: draft });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch deductions', message: (error as Error).message });
    }
  }
}
