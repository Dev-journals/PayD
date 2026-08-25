import { pool } from '../config/database.js';
import logger from '../utils/logger.js';

export interface TenantQuotas {
  maxEmployees: number;
  maxMonthlyTransactions: number;
  maxStorageMb: number;
  quotaAlertThreshold: number;
}

export interface QuotaUsage {
  employeeCount: number;
  monthlyTransactionCount: number;
  storageMb: number;
}

export class QuotaExceededError extends Error {
  constructor(
    public readonly resource: 'employees' | 'transactions' | 'storage',
    public readonly current: number,
    public readonly limit: number
  ) {
    super(`Quota exceeded for '${resource}': current=${current}, limit=${limit}`);
    this.name = 'QuotaExceededError';
  }
}

export class TenantQuotaService {
  /**
   * Fetch the quota configuration for an organisation.
   * Falls back to generous defaults if no row exists in organization_settings.
   */
  async getQuotas(organizationId: number): Promise<TenantQuotas> {
    const result = await pool.query(
      `SELECT max_employees, max_monthly_transactions, max_storage_mb, quota_alert_threshold
         FROM organization_settings
        WHERE organization_id = $1`,
      [organizationId]
    );

    if (result.rows.length === 0) {
      return {
        maxEmployees: 500,
        maxMonthlyTransactions: 10_000,
        maxStorageMb: 1_024,
        quotaAlertThreshold: 0.8,
      };
    }

    const row = result.rows[0];
    return {
      maxEmployees: row.max_employees ?? 500,
      maxMonthlyTransactions: row.max_monthly_transactions ?? 10_000,
      maxStorageMb: row.max_storage_mb ?? 1_024,
      quotaAlertThreshold: parseFloat(row.quota_alert_threshold ?? '0.80'),
    };
  }

  /**
   * Return the current live usage figures for an organisation.
   */
  async getCurrentUsage(organizationId: number): Promise<QuotaUsage> {
    const [empResult, txResult] = await Promise.all([
      pool.query<{ count: string }>(
        `SELECT COUNT(*) FROM employees WHERE organization_id = $1 AND deleted_at IS NULL`,
        [organizationId]
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(*) FROM transactions
          WHERE organization_id = $1
            AND created_at >= date_trunc('month', NOW())`,
        [organizationId]
      ),
    ]);

    return {
      employeeCount: parseInt(empResult.rows[0]?.count ?? '0', 10),
      monthlyTransactionCount: parseInt(txResult.rows[0]?.count ?? '0', 10),
      storageMb: 0, // placeholder — real implementation queries object storage API
    };
  }

  /**
   * Assert that adding one more employee will not breach the quota.
   * Throws QuotaExceededError if it would.
   * Emits a warning log if usage is approaching the threshold.
   */
  async assertEmployeeQuota(organizationId: number): Promise<void> {
    const [quotas, usage] = await Promise.all([
      this.getQuotas(organizationId),
      this.getCurrentUsage(organizationId),
    ]);

    const approaching = usage.employeeCount / quotas.maxEmployees >= quotas.quotaAlertThreshold;

    if (usage.employeeCount >= quotas.maxEmployees) {
      logger.warn('Employee quota exceeded', {
        organizationId,
        current: usage.employeeCount,
        limit: quotas.maxEmployees,
      });
      throw new QuotaExceededError('employees', usage.employeeCount, quotas.maxEmployees);
    }

    if (approaching) {
      logger.warn('Employee quota approaching limit', {
        organizationId,
        current: usage.employeeCount,
        limit: quotas.maxEmployees,
        threshold: quotas.quotaAlertThreshold,
      });
      await this.emitQuotaApproachingEvent(organizationId, 'employees', usage.employeeCount, quotas.maxEmployees);
    }
  }

  /**
   * Assert that adding one more transaction will not breach the monthly quota.
   */
  async assertTransactionQuota(organizationId: number): Promise<void> {
    const [quotas, usage] = await Promise.all([
      this.getQuotas(organizationId),
      this.getCurrentUsage(organizationId),
    ]);

    const approaching =
      usage.monthlyTransactionCount / quotas.maxMonthlyTransactions >= quotas.quotaAlertThreshold;

    if (usage.monthlyTransactionCount >= quotas.maxMonthlyTransactions) {
      throw new QuotaExceededError(
        'transactions',
        usage.monthlyTransactionCount,
        quotas.maxMonthlyTransactions
      );
    }

    if (approaching) {
      await this.emitQuotaApproachingEvent(
        organizationId,
        'transactions',
        usage.monthlyTransactionCount,
        quotas.maxMonthlyTransactions
      );
    }
  }

  /**
   * Persist a daily usage snapshot for billing and capacity planning.
   * Designed to be called by a scheduled cron job (e.g. midnight UTC).
   */
  async snapshotDailyUsage(organizationId: number): Promise<void> {
    const usage = await this.getCurrentUsage(organizationId);
    const today = new Date().toISOString().slice(0, 10);

    await pool.query(
      `INSERT INTO tenant_usage_snapshots
         (organization_id, snapshot_date, employee_count, transaction_count, storage_bytes, api_calls)
       VALUES ($1, $2, $3, $4, $5, 0)
       ON CONFLICT (organization_id, snapshot_date)
       DO UPDATE SET
         employee_count = EXCLUDED.employee_count,
         transaction_count = EXCLUDED.transaction_count,
         storage_bytes = EXCLUDED.storage_bytes`,
      [organizationId, today, usage.employeeCount, usage.monthlyTransactionCount, usage.storageMb * 1024 * 1024]
    );

    logger.info('Tenant usage snapshot saved', { organizationId, date: today, ...usage });
  }

  /**
   * Run daily snapshots for ALL active organisations.
   * Called by the scheduler; errors for one org do not abort others.
   */
  async snapshotAllTenants(): Promise<void> {
    const orgsResult = await pool.query<{ id: number }>(
      `SELECT id FROM organizations WHERE is_active = true`
    );

    await Promise.allSettled(
      orgsResult.rows.map((row) =>
        this.snapshotDailyUsage(row.id).catch((err) =>
          logger.error('Snapshot failed for org', { organizationId: row.id, err })
        )
      )
    );
  }

  private async emitQuotaApproachingEvent(
    organizationId: number,
    resource: string,
    current: number,
    limit: number
  ): Promise<void> {
    // Structured log picked up by the alerting pipeline
    logger.warn('tenant.quota.approaching', {
      event: 'tenant.quota.approaching',
      organizationId,
      resource,
      current,
      limit,
      utilisationPct: Math.round((current / limit) * 100),
    });
  }
}

export const tenantQuotaService = new TenantQuotaService();
