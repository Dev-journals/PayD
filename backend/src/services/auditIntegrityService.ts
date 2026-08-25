import { createHash } from 'crypto';
import { pool } from '../config/database.js';
import logger from '../utils/logger.js';

export interface IntegrityCheckResult {
  passed: boolean;
  totalRows: number;
  checkedRows: number;
  brokenAt?: number;
  brokenChainHash?: string;
  recomputedChainHash?: string;
  checkedAt: Date;
}

export interface AuditRowForVerification {
  id: number;
  user_id: string | null;
  user_email: string | null;
  organization_id: number | null;
  action: string;
  resource: string;
  resource_id: string | null;
  method: string;
  path: string;
  response_status: number | null;
  created_at: Date;
  row_hash: string | null;
  chain_hash: string | null;
}

/**
 * Recompute the row_hash for a given audit log row using the same deterministic
 * formula used by the PostgreSQL trigger (compute_audit_chain_hash).
 */
export function recomputeRowHash(row: AuditRowForVerification): string {
  const data = [
    row.user_id ?? '',
    row.user_email ?? '',
    row.organization_id?.toString() ?? '',
    row.action,
    row.resource,
    row.resource_id ?? '',
    row.method,
    row.path,
    row.response_status?.toString() ?? '',
    row.created_at.toISOString().replace('T', ' ').replace('Z', ''),
  ].join('|');

  return createHash('sha256').update(data).digest('hex');
}

/**
 * Recompute the chain_hash for a row given its row_hash and the previous row's
 * chain_hash (or 'genesis' for the first row).
 */
export function recomputeChainHash(rowHash: string, prevChainHash: string): string {
  return createHash('sha256').update(rowHash + prevChainHash).digest('hex');
}

export class AuditIntegrityService {
  /**
   * Walk every row in api_audit_logs (oldest-first) and verify:
   *   1. The stored row_hash matches the recomputed hash of the row's immutable fields
   *   2. The stored chain_hash matches SHA-256(row_hash || prev_chain_hash)
   *
   * Returns on the first broken link so the caller knows exactly where tampering occurred.
   */
  async verifyIntegrity(opts: { limit?: number } = {}): Promise<IntegrityCheckResult> {
    const limit = opts.limit ?? 100_000;

    const countResult = await pool.query<{ count: string }>(
      'SELECT COUNT(*) FROM api_audit_logs'
    );
    const totalRows = parseInt(countResult.rows[0].count, 10);

    const result = await pool.query<AuditRowForVerification>(
      `SELECT id, user_id, user_email, organization_id, action, resource, resource_id,
              method, path, response_status, created_at, row_hash, chain_hash
         FROM api_audit_logs
        ORDER BY id ASC
        LIMIT $1`,
      [limit]
    );

    let prevChainHash = 'genesis';
    let checkedRows = 0;

    for (const row of result.rows) {
      checkedRows++;

      // Skip rows that predate the hash-chain migration (no row_hash yet)
      if (!row.row_hash || !row.chain_hash) {
        prevChainHash = row.chain_hash ?? prevChainHash;
        continue;
      }

      const expectedRowHash = recomputeRowHash(row);
      if (row.row_hash !== expectedRowHash) {
        logger.error('Audit integrity violation — row_hash mismatch', {
          rowId: row.id,
          storedRowHash: row.row_hash,
          recomputedRowHash: expectedRowHash,
        });
        return {
          passed: false,
          totalRows,
          checkedRows,
          brokenAt: row.id,
          brokenChainHash: row.chain_hash,
          recomputedChainHash: expectedRowHash,
          checkedAt: new Date(),
        };
      }

      const expectedChainHash = recomputeChainHash(row.row_hash, prevChainHash);
      if (row.chain_hash !== expectedChainHash) {
        logger.error('Audit integrity violation — chain_hash mismatch', {
          rowId: row.id,
          storedChainHash: row.chain_hash,
          recomputedChainHash: expectedChainHash,
        });
        return {
          passed: false,
          totalRows,
          checkedRows,
          brokenAt: row.id,
          brokenChainHash: row.chain_hash,
          recomputedChainHash: expectedChainHash,
          checkedAt: new Date(),
        };
      }

      prevChainHash = row.chain_hash;
    }

    logger.info('Audit integrity check passed', { totalRows, checkedRows });
    return {
      passed: true,
      totalRows,
      checkedRows,
      checkedAt: new Date(),
    };
  }

  /**
   * Convenience method that runs verifyIntegrity and emits a structured log
   * entry suitable for forwarding to a SIEM or alerting system.
   */
  async runScheduledCheck(): Promise<void> {
    const result = await this.verifyIntegrity();
    if (result.passed) {
      logger.info('audit_integrity_check', { status: 'passed', ...result });
    } else {
      logger.error('audit_integrity_check', { status: 'FAILED', ...result });
    }
  }
}

export const auditIntegrityService = new AuditIntegrityService();
