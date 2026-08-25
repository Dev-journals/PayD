/**
 * Unit tests for TenantQuotaService (Part 49)
 * DB pool is mocked — no live Postgres needed.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { TenantQuotaService, QuotaExceededError } from '../tenantQuotaService.js';

const mockQuery = jest.fn();

jest.mock('../../config/database.js', () => ({
  pool: { query: (...args: any[]) => mockQuery(...args) },
}));

function makeService() {
  return new TenantQuotaService();
}

describe('TenantQuotaService.getQuotas', () => {
  beforeEach(() => mockQuery.mockReset());

  it('returns DB row values when a settings row exists', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        max_employees: 1000,
        max_monthly_transactions: 50000,
        max_storage_mb: 2048,
        quota_alert_threshold: '0.75',
      }],
    });

    const svc = makeService();
    const quotas = await svc.getQuotas(1);

    expect(quotas.maxEmployees).toBe(1000);
    expect(quotas.maxMonthlyTransactions).toBe(50000);
    expect(quotas.quotaAlertThreshold).toBe(0.75);
  });

  it('returns safe defaults when no settings row exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const svc = makeService();
    const quotas = await svc.getQuotas(99);

    expect(quotas.maxEmployees).toBe(500);
    expect(quotas.maxMonthlyTransactions).toBe(10_000);
    expect(quotas.maxStorageMb).toBe(1_024);
    expect(quotas.quotaAlertThreshold).toBe(0.8);
  });
});

describe('TenantQuotaService.assertEmployeeQuota', () => {
  beforeEach(() => mockQuery.mockReset());

  function setupMocks(currentCount: number, limit: number) {
    // getQuotas query
    mockQuery.mockResolvedValueOnce({
      rows: [{ max_employees: limit, max_monthly_transactions: 10000, max_storage_mb: 1024, quota_alert_threshold: '0.80' }],
    });
    // getCurrentUsage — employee count
    mockQuery.mockResolvedValueOnce({ rows: [{ count: String(currentCount) }] });
    // getCurrentUsage — transaction count
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });
  }

  it('throws QuotaExceededError when at the limit', async () => {
    setupMocks(500, 500);
    const svc = makeService();
    await expect(svc.assertEmployeeQuota(1)).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('throws QuotaExceededError when over the limit', async () => {
    setupMocks(501, 500);
    const svc = makeService();
    await expect(svc.assertEmployeeQuota(1)).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('does not throw when under the limit', async () => {
    setupMocks(100, 500);
    const svc = makeService();
    await expect(svc.assertEmployeeQuota(1)).resolves.toBeUndefined();
  });

  it('QuotaExceededError carries correct resource and numbers', async () => {
    setupMocks(500, 500);
    const svc = makeService();
    try {
      await svc.assertEmployeeQuota(1);
      expect(true).toBe(false); // should not reach here
    } catch (err) {
      expect(err).toBeInstanceOf(QuotaExceededError);
      const qErr = err as QuotaExceededError;
      expect(qErr.resource).toBe('employees');
      expect(qErr.current).toBe(500);
      expect(qErr.limit).toBe(500);
    }
  });
});
