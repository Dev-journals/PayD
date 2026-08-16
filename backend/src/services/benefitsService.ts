import pool from '../config/database.js';
import { Money } from '../utils/money.js';

export interface BenefitPlan {
  id: number;
  organization_id: number;
  name: string;
  description: string | null;
  provider_name: string | null;
  provider_wallet_address: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface EmployeeBenefitEnrollment {
  id: number;
  organization_id: number;
  employee_id: number;
  benefit_plan_id: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface DeductionRule {
  id: number;
  organization_id: number;
  name: string;
  type: 'percentage' | 'fixed';
  value: string;
  description: string | null;
  is_active: boolean;
  priority: number;
  benefit_plan_id: number | null;
  employee_id: number | null;
  destination_wallet_address: string | null;
  destination_kind: 'treasury' | 'provider';
  created_at: Date;
  updated_at: Date;
}

export interface DraftPayslipLine {
  source: 'deduction_rule' | 'tax_rule';
  source_id: number;
  name: string;
  type: 'percentage' | 'fixed';
  value: number;
  amount: number;
  destination_wallet_address: string | null;
  destination_kind: 'treasury' | 'provider';
}

export interface DraftPayslip {
  organization_id: number;
  employee_id: number;
  currency: string;
  gross_amount: number;
  lines: DraftPayslipLine[];
  total_deductions: number;
  net_amount: number;
}

function round7(n: number): number {
  return Money.from(n).toNumber();
}

export class BenefitsService {
  async createBenefitPlan(input: {
    organization_id: number;
    name: string;
    description?: string;
    provider_name?: string;
    provider_wallet_address?: string;
    is_active?: boolean;
  }): Promise<BenefitPlan> {
    const result = await pool.query(
      `INSERT INTO benefit_plans (
        organization_id, name, description, provider_name, provider_wallet_address, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [
        input.organization_id,
        input.name,
        input.description || null,
        input.provider_name || null,
        input.provider_wallet_address || null,
        input.is_active ?? true,
      ]
    );

    return result.rows[0];
  }

  async listBenefitPlans(organizationId: number, includeInactive = false): Promise<BenefitPlan[]> {
    const activeClause = includeInactive ? '' : 'AND is_active = TRUE';
    const result = await pool.query(
      `SELECT * FROM benefit_plans WHERE organization_id = $1 ${activeClause} ORDER BY created_at DESC`,
      [organizationId]
    );
    return result.rows;
  }

  async updateBenefitPlan(
    id: number,
    updates: Partial<{
      name: string;
      description: string;
      provider_name: string;
      provider_wallet_address: string;
      is_active: boolean;
    }>
  ): Promise<BenefitPlan | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined) {
        fields.push(`${k} = $${idx++}`);
        values.push(v);
      }
    }

    if (fields.length === 0) return null;

    values.push(id);
    const result = await pool.query(
      `UPDATE benefit_plans SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    return result.rows[0] || null;
  }

  async deleteBenefitPlan(id: number): Promise<boolean> {
    const result = await pool.query(`UPDATE benefit_plans SET is_active = FALSE WHERE id = $1`, [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async upsertEmployeeEnrollment(input: {
    organization_id: number;
    employee_id: number;
    benefit_plan_id: number;
    is_active?: boolean;
  }): Promise<EmployeeBenefitEnrollment> {
    const result = await pool.query(
      `INSERT INTO employee_benefit_enrollments (
        organization_id, employee_id, benefit_plan_id, is_active
      ) VALUES ($1, $2, $3, $4)
      ON CONFLICT (employee_id, benefit_plan_id)
      DO UPDATE SET is_active = $4, updated_at = NOW()
      RETURNING *`,
      [input.organization_id, input.employee_id, input.benefit_plan_id, input.is_active ?? true]
    );

    return result.rows[0];
  }

  async listEmployeeEnrollments(organizationId: number, employeeId: number): Promise<EmployeeBenefitEnrollment[]> {
    const result = await pool.query(
      `SELECT * FROM employee_benefit_enrollments
       WHERE organization_id = $1 AND employee_id = $2
       ORDER BY created_at DESC`,
      [organizationId, employeeId]
    );

    return result.rows;
  }

  async createDeductionRule(input: {
    organization_id: number;
    name: string;
    type: 'percentage' | 'fixed';
    value: number;
    description?: string;
    is_active?: boolean;
    priority?: number;
    benefit_plan_id?: number;
    employee_id?: number;
    destination_wallet_address?: string;
    destination_kind?: 'treasury' | 'provider';
  }): Promise<DeductionRule> {
    const result = await pool.query(
      `INSERT INTO deduction_rules (
        organization_id, name, type, value, description, is_active, priority,
        benefit_plan_id, employee_id, destination_wallet_address, destination_kind
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *`,
      [
        input.organization_id,
        input.name,
        input.type,
        input.value,
        input.description || null,
        input.is_active ?? true,
        input.priority ?? 0,
        input.benefit_plan_id || null,
        input.employee_id || null,
        input.destination_wallet_address || null,
        input.destination_kind ?? 'treasury',
      ]
    );

    return result.rows[0];
  }

  async listDeductionRules(organizationId: number, includeInactive = false): Promise<DeductionRule[]> {
    const activeClause = includeInactive ? '' : 'AND is_active = TRUE';
    const result = await pool.query(
      `SELECT * FROM deduction_rules WHERE organization_id = $1 ${activeClause} ORDER BY priority ASC, created_at ASC`,
      [organizationId]
    );
    return result.rows;
  }

  async updateDeductionRule(id: number, updates: Partial<DeductionRule>): Promise<DeductionRule | null> {
    const allowed = new Set([
      'name',
      'type',
      'value',
      'description',
      'is_active',
      'priority',
      'benefit_plan_id',
      'employee_id',
      'destination_wallet_address',
      'destination_kind',
    ]);

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const [k, v] of Object.entries(updates)) {
      if (!allowed.has(k)) continue;
      if (v !== undefined) {
        fields.push(`${k} = $${idx++}`);
        values.push(v);
      }
    }

    if (fields.length === 0) return null;

    values.push(id);
    const result = await pool.query(
      `UPDATE deduction_rules SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    return result.rows[0] || null;
  }

  async deleteDeductionRule(id: number): Promise<boolean> {
    const result = await pool.query(`UPDATE deduction_rules SET is_active = FALSE WHERE id = $1`, [id]);
    return (result.rowCount ?? 0) > 0;
  }

  private async resolveTreasuryWalletAddress(organizationId: number, assetCode: string): Promise<string | null> {
    const result = await pool.query(
      `SELECT wallet_address
       FROM wallets
       WHERE organization_id = $1
         AND wallet_type IN ('treasury', 'organization')
         AND is_active = TRUE
         AND asset_code = $2
       ORDER BY created_at ASC
       LIMIT 1`,
      [organizationId, assetCode]
    );

    return result.rows[0]?.wallet_address || null;
  }

  private async resolveProviderWalletAddress(benefitPlanId: number): Promise<string | null> {
    const result = await pool.query(
      `SELECT provider_wallet_address
       FROM benefit_plans
       WHERE id = $1`,
      [benefitPlanId]
    );

    return result.rows[0]?.provider_wallet_address || null;
  }

  private async isEmployeeEnrolled(employeeId: number, benefitPlanId: number): Promise<boolean> {
    const result = await pool.query(
      `SELECT 1
       FROM employee_benefit_enrollments
       WHERE employee_id = $1 AND benefit_plan_id = $2 AND is_active = TRUE
       LIMIT 1`,
      [employeeId, benefitPlanId]
    );

    return result.rows.length > 0;
  }

  async generateDraftPayslip(input: {
    organization_id: number;
    employee_id: number;
    gross_amount?: number;
    currency?: string;
  }): Promise<DraftPayslip> {
    const empResult = await pool.query(
      `SELECT id, base_salary, base_currency
       FROM employees
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [input.employee_id, input.organization_id]
    );

    if (!empResult.rows[0]) {
      throw new Error('Employee not found');
    }

    const employee = empResult.rows[0];
    const currency = input.currency || employee.base_currency || 'USDC';
    const gross = round7(
      input.gross_amount !== undefined ? input.gross_amount : parseFloat(employee.base_salary || 0)
    );

    const lines: DraftPayslipLine[] = [];

    // Deduction rules
    const rulesResult = await pool.query(
      `SELECT *
       FROM deduction_rules
       WHERE organization_id = $1
         AND is_active = TRUE
         AND (employee_id IS NULL OR employee_id = $2)
       ORDER BY priority ASC, created_at ASC`,
      [input.organization_id, input.employee_id]
    );

    for (const rule of rulesResult.rows as DeductionRule[]) {
      if (rule.benefit_plan_id) {
        const enrolled = await this.isEmployeeEnrolled(input.employee_id, rule.benefit_plan_id);
        if (!enrolled) continue;
      }

      const ruleValue = parseFloat(rule.value);
      const grossMoney = Money.from(gross);
      const amount =
        rule.type === 'percentage'
          ? grossMoney.percentage(ruleValue).toNumber()
          : Money.from(ruleValue).toNumber();

      let destinationWallet = rule.destination_wallet_address;
      if (!destinationWallet) {
        if (rule.destination_kind === 'provider' && rule.benefit_plan_id) {
          destinationWallet = await this.resolveProviderWalletAddress(rule.benefit_plan_id);
        } else if (rule.destination_kind === 'treasury') {
          destinationWallet = await this.resolveTreasuryWalletAddress(input.organization_id, currency);
        }
      }

      lines.push({
        source: 'deduction_rule',
        source_id: rule.id,
        name: rule.name,
        type: rule.type,
        value: ruleValue,
        amount,
        destination_wallet_address: destinationWallet || null,
        destination_kind: rule.destination_kind,
      });
    }

    // Tax rules as deductions
    const taxResult = await pool.query(
      `SELECT id, name, type, value
       FROM tax_rules
       WHERE organization_id = $1 AND is_active = TRUE
       ORDER BY priority ASC, created_at ASC`,
      [input.organization_id]
    );

    for (const tax of taxResult.rows as Array<{ id: number; name: string; type: 'percentage' | 'fixed'; value: string }>) {
      const taxValue = parseFloat(tax.value);
      const grossMoney = Money.from(gross);
      const amount =
        tax.type === 'percentage'
          ? grossMoney.percentage(taxValue).toNumber()
          : Money.from(taxValue).toNumber();

      const treasuryWallet = await this.resolveTreasuryWalletAddress(input.organization_id, currency);

      lines.push({
        source: 'tax_rule',
        source_id: tax.id,
        name: tax.name,
        type: tax.type,
        value: taxValue,
        amount,
        destination_wallet_address: treasuryWallet || null,
        destination_kind: 'treasury',
      });
    }

    let totalDeductionsMoney = Money.zero();
    for (const l of lines) {
      totalDeductionsMoney = totalDeductionsMoney.add(Money.from(l.amount));
    }
    const totalDeductions = totalDeductionsMoney.toNumber();
    const net = Math.max(0, Money.from(gross).sub(totalDeductionsMoney).toNumber());

    return {
      organization_id: input.organization_id,
      employee_id: input.employee_id,
      currency,
      gross_amount: gross,
      lines,
      total_deductions: totalDeductions,
      net_amount: net,
    };
  }
}

export const benefitsService = new BenefitsService();
