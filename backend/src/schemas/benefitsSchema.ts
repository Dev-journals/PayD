import { z } from 'zod';

export const benefitPlanSchema = z.object({
  organization_id: z.number().int().positive(),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  provider_name: z.string().max(255).optional(),
  provider_wallet_address: z.string().length(56).optional(),
  is_active: z.boolean().optional().default(true),
});

export const updateBenefitPlanSchema = benefitPlanSchema.partial().omit({ organization_id: true });

export const employeeBenefitEnrollmentSchema = z.object({
  organization_id: z.number().int().positive(),
  employee_id: z.number().int().positive(),
  benefit_plan_id: z.number().int().positive(),
  is_active: z.boolean().optional().default(true),
});

export const updateEmployeeBenefitEnrollmentSchema = employeeBenefitEnrollmentSchema
  .partial()
  .omit({ organization_id: true, employee_id: true, benefit_plan_id: true });

export const deductionRuleSchema = z.object({
  organization_id: z.number().int().positive(),
  name: z.string().min(1).max(255),
  type: z.enum(['percentage', 'fixed']),
  value: z.number().nonnegative(),
  description: z.string().optional(),
  is_active: z.boolean().optional().default(true),
  priority: z.number().int().optional().default(0),
  benefit_plan_id: z.number().int().positive().optional(),
  employee_id: z.number().int().positive().optional(),
  destination_wallet_address: z.string().length(56).optional(),
  destination_kind: z.enum(['treasury', 'provider']).optional().default('treasury'),
});

export const updateDeductionRuleSchema = deductionRuleSchema.partial().omit({ organization_id: true });

export const draftPayslipSchema = z.object({
  employee_id: z.number().int().positive(),
  organization_id: z.number().int().positive(),
  gross_amount: z.number().nonnegative().optional(),
  currency: z.string().max(12).optional(),
});

export type CreateBenefitPlanInput = z.infer<typeof benefitPlanSchema>;
export type UpdateBenefitPlanInput = z.infer<typeof updateBenefitPlanSchema>;
export type CreateEmployeeBenefitEnrollmentInput = z.infer<typeof employeeBenefitEnrollmentSchema>;
export type UpdateEmployeeBenefitEnrollmentInput = z.infer<typeof updateEmployeeBenefitEnrollmentSchema>;
export type CreateDeductionRuleInput = z.infer<typeof deductionRuleSchema>;
export type UpdateDeductionRuleInput = z.infer<typeof updateDeductionRuleSchema>;
export type DraftPayslipInput = z.infer<typeof draftPayslipSchema>;
