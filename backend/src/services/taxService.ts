import { Pool } from 'pg';
import pool from '../config/database.js';
import { Money } from '../utils/money.js';
import { createTaxComplianceProvider } from './taxCompliance/factory.js';
import type { TaxComplianceProvider } from './taxCompliance/types.js';

export interface TaxRule {
  id: number;
  organization_id: number;
  name: string;
  type: 'percentage' | 'fixed';
  value: number;
  description: string | null;
  is_active: boolean;
  priority: number;
  created_at: Date;
  updated_at: Date;
}

export interface CreateTaxRuleInput {
  organization_id: number;
  name: string;
  type: 'percentage' | 'fixed';
  value: number;
  description?: string;
  priority?: number;
}

export interface UpdateTaxRuleInput {
  name?: string;
  type?: 'percentage' | 'fixed';
  value?: number;
  description?: string;
  is_active?: boolean;
  priority?: number;
}

export interface TaxDeduction {
  rule_id: number;
  rule_name: string;
  type: 'percentage' | 'fixed';
  rule_value: number;
  deducted_amount: number;
}

export interface DeductionResult {
  gross_amount: number;
  deductions: TaxDeduction[];
  total_tax: number;
  net_amount: number;
}

export interface TaxReportEntry {
  rule_name: string;
  rule_type: string;
  rule_value: number;
  total_gross: number;
  total_tax: number;
  total_net: number;
  transaction_count: number;
}

export interface TaxReport {
  organization_id: number;
  period_start: string;
  period_end: string;
  entries: TaxReportEntry[];
  summary: {
    total_gross: number;
    total_tax: number;
    total_net: number;
  };
}

export class TaxService {
  private pool: Pool;
  private taxComplianceProvider: TaxComplianceProvider;

  constructor(poolInstance: Pool = pool) {
    this.pool = poolInstance;

    this.taxComplianceProvider = createTaxComplianceProvider(
      async (organizationId: number, grossAmount: number) => {
        const result = await this.calculateDeductionsRuleBased(organizationId, grossAmount);

        return {
          grossAmount: result.gross_amount,
          totalTax: result.total_tax,
          netAmount: result.net_amount,
          deductions: result.deductions.map((d) => ({
            name: d.rule_name,
            type: d.type,
            value: d.rule_value,
            deductedAmount: d.deducted_amount,
          })),
        };
      }
    );
  }

  private async getEmployeeResidencyCountry(
    organizationId: number,
    employeeId: number
  ): Promise<string | null> {
    const result = await this.pool.query(
      `SELECT country FROM employees WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [employeeId, organizationId]
    );

    if (!result.rows[0]) {
      throw new Error('Employee not found');
    }

    return result.rows[0].country ?? null;
  }

  /**
   * Create a new tax rule for an organization
   */
  async createRule(input: CreateTaxRuleInput): Promise<TaxRule> {
    const { organization_id, name, type, value, description, priority } = input;

    const result = await this.pool.query(
      `INSERT INTO tax_rules (organization_id, name, type, value, description, priority)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [organization_id, name, type, value, description || null, priority ?? 0]
    );

    return result.rows[0];
  }

  /**
   * Retrieve all active tax rules for an organization, ordered by priority
   */
  async getRules(organizationId: number, includeInactive = false): Promise<TaxRule[]> {
    const activeClause = includeInactive ? '' : 'AND is_active = TRUE';

    const result = await this.pool.query(
      `SELECT * FROM tax_rules
       WHERE organization_id = $1 ${activeClause}
       ORDER BY priority ASC, created_at ASC`,
      [organizationId]
    );

    return result.rows;
  }

  /**
   * Update an existing tax rule
   */
  async updateRule(ruleId: number, updates: UpdateTaxRuleInput): Promise<TaxRule | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.name !== undefined) {
      fields.push(`name = $${paramIndex++}`);
      values.push(updates.name);
    }
    if (updates.type !== undefined) {
      fields.push(`type = $${paramIndex++}`);
      values.push(updates.type);
    }
    if (updates.value !== undefined) {
      fields.push(`value = $${paramIndex++}`);
      values.push(updates.value);
    }
    if (updates.description !== undefined) {
      fields.push(`description = $${paramIndex++}`);
      values.push(updates.description);
    }
    if (updates.is_active !== undefined) {
      fields.push(`is_active = $${paramIndex++}`);
      values.push(updates.is_active);
    }
    if (updates.priority !== undefined) {
      fields.push(`priority = $${paramIndex++}`);
      values.push(updates.priority);
    }

    if (fields.length === 0) return null;

    values.push(ruleId);

    const result = await this.pool.query(
      `UPDATE tax_rules SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    return result.rows[0] || null;
  }

  /**
   * Soft-delete a tax rule by deactivating it
   */
  async deleteRule(ruleId: number): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE tax_rules SET is_active = FALSE WHERE id = $1 RETURNING id`,
      [ruleId]
    );

    return result.rowCount !== null && result.rowCount > 0;
  }

  /**
   * Calculate all tax deductions for a given gross amount using an organization's active rules.
   * Rules are applied in priority order (ascending).
   */
  async calculateDeductions(
    organizationId: number,
    grossAmount: number,
    employeeId?: number,
    currency?: string
  ): Promise<DeductionResult> {
    if (employeeId !== undefined) {
      const residencyCountry = await this.getEmployeeResidencyCountry(organizationId, employeeId);
      const result = await this.taxComplianceProvider.calculate({
        organizationId,
        employeeId,
        employeeResidencyCountry: residencyCountry,
        grossAmount,
        currency,
      });

      return {
        gross_amount: result.grossAmount,
        deductions: result.deductions.map((d) => ({
          rule_id: 0,
          rule_name: d.name,
          type: d.type,
          rule_value: d.value,
          deducted_amount: d.deductedAmount,
        })),
        total_tax: result.totalTax,
        net_amount: result.netAmount,
      };
    }

    return this.calculateDeductionsRuleBased(organizationId, grossAmount);
  }

  private async calculateDeductionsRuleBased(
    organizationId: number,
    grossAmount: number
  ): Promise<DeductionResult> {
    const rules = await this.getRules(organizationId);
    const deductions: TaxDeduction[] = [];
    const gross = Money.from(grossAmount);
    let totalTax = Money.zero();

    for (const rule of rules) {
      let deductedAmount = Money.zero();

      if (rule.type === 'percentage') {
        deductedAmount = gross.percentage(Number(rule.value));
      } else if (rule.type === 'fixed') {
        deductedAmount = Money.from(Number(rule.value));
      }

      deductions.push({
        rule_id: rule.id,
        rule_name: rule.name,
        type: rule.type,
        rule_value: Number(rule.value),
        deducted_amount: deductedAmount.toNumber(),
      });

      totalTax = totalTax.add(deductedAmount);
    }

    const netAmount = gross.sub(totalTax);

    return {
      gross_amount: grossAmount,
      deductions,
      total_tax: totalTax.toNumber(),
      net_amount: Math.max(0, netAmount.toNumber()),
    };
  }

  /**
   * Record a tax deduction in the tax_reports table
   */
  async recordDeduction(
    organizationId: number,
    employeeId: number | null,
    transactionId: number | null,
    taxRuleId: number,
    grossAmount: number,
    taxAmount: number,
    netAmount: number,
    periodStart?: string,
    periodEnd?: string
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO tax_reports
       (organization_id, employee_id, transaction_id, tax_rule_id, gross_amount, tax_amount, net_amount, period_start, period_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        organizationId,
        employeeId,
        transactionId,
        taxRuleId,
        grossAmount,
        taxAmount,
        netAmount,
        periodStart || null,
        periodEnd || null,
      ]
    );
  }

  /**
   * Generate a compliance tax report for an organization over a given period
   */
  async generateReport(
    organizationId: number,
    periodStart: string,
    periodEnd: string
  ): Promise<TaxReport> {
    const result = await this.pool.query(
      `SELECT
         tr.name AS rule_name,
         tr.type AS rule_type,
         tr.value AS rule_value,
         COALESCE(SUM(trp.gross_amount), 0) AS total_gross,
         COALESCE(SUM(trp.tax_amount), 0) AS total_tax,
         COALESCE(SUM(trp.net_amount), 0) AS total_net,
         COUNT(trp.id) AS transaction_count
       FROM tax_rules tr
       LEFT JOIN tax_reports trp
         ON tr.id = trp.tax_rule_id
         AND trp.generated_at >= $2
         AND trp.generated_at <= $3
       WHERE tr.organization_id = $1
       GROUP BY tr.id, tr.name, tr.type, tr.value
       ORDER BY tr.priority ASC`,
      [organizationId, periodStart, periodEnd]
    );

    const entries: TaxReportEntry[] = result.rows.map((row: any) => ({
      rule_name: row.rule_name,
      rule_type: row.rule_type,
      rule_value: Money.from(row.rule_value).toNumber(),
      total_gross: Money.from(row.total_gross).toNumber(),
      total_tax: Money.from(row.total_tax).toNumber(),
      total_net: Money.from(row.total_net).toNumber(),
      transaction_count: parseInt(row.transaction_count, 10),
    }));

    let totalGross = Money.zero();
    let totalTaxSum = Money.zero();
    let totalNetSum = Money.zero();
    for (const entry of entries) {
      totalGross = totalGross.add(Money.from(entry.total_gross));
      totalTaxSum = totalTaxSum.add(Money.from(entry.total_tax));
      totalNetSum = totalNetSum.add(Money.from(entry.total_net));
    }

    const summary = {
      total_gross: totalGross.toNumber(),
      total_tax: totalTaxSum.toNumber(),
      total_net: totalNetSum.toNumber(),
    };

    return {
      organization_id: organizationId,
      period_start: periodStart,
      period_end: periodEnd,
      entries,
      summary,
    };
  }
}

export default new TaxService();
