import { query } from '../config/database.js';
import logger from '../utils/logger.js';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface IdempotencyRecord {
  id: number;
  organizationId: number;
  idempotencyKey: string;
  status: 'in_progress' | 'completed' | 'failed';
  responseStatus: number | null;
  responseBody: unknown;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * Store an idempotency key with a lock (in_progress status).
 * Returns the existing record if the key already exists and is not expired.
 * Returns null if the key is newly created.
 * Throws if the key is in_progress (concurrent duplicate).
 */
export async function claimKey(
  organizationId: number,
  idempotencyKey: string,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<IdempotencyRecord | null> {
  const expiresAt = new Date(Date.now() + ttlMs);

  try {
    // Try to insert a new in_progress record.
    // If the key already exists with a completed/failed status and is not expired,
    // return it so the caller can replay the stored response.
    // If the key exists but is expired, overwrite it.
    const result = await query(
      `INSERT INTO idempotency_keys (organization_id, idempotency_key, status, expires_at)
       VALUES ($1, $2, 'in_progress', $3)
       ON CONFLICT (organization_id, idempotency_key)
       DO UPDATE SET
         status = CASE
           WHEN idempotency_keys.expires_at > NOW() AND idempotency_keys.status IN ('completed', 'failed')
             THEN idempotency_keys.status  -- keep completed/failed, return it
           ELSE 'in_progress'              -- overwrite expired or re-lock
         END,
         expires_at = CASE
           WHEN idempotency_keys.expires_at > NOW() AND idempotency_keys.status IN ('completed', 'failed')
             THEN idempotency_keys.expires_at  -- keep existing TTL for replay
           ELSE $3                             -- new TTL for fresh/expired keys
         END
       RETURNING id, organization_id, idempotency_key, status, response_status, response_body, created_at, expires_at`,
      [organizationId, idempotencyKey, expiresAt],
    );

    const row = result.rows[0];
    if (!row) return null;

    const record: IdempotencyRecord = {
      id: row.id,
      organizationId: row.organization_id,
      idempotencyKey: row.idempotency_key,
      status: row.status,
      responseStatus: row.response_status,
      responseBody: row.response_body,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };

    // If the existing record is completed or failed and not expired, it's a replay.
    if (record.status === 'completed' || record.status === 'failed') {
      return record;
    }

    // If status is still in_progress, we need to check if this is a concurrent duplicate.
    // The INSERT with ON CONFLICT DO UPDATE just set it back to in_progress,
    // so this is a new claim. Return null to let the caller proceed.
    return null;
  } catch (error) {
    logger.error('Failed to claim idempotency key', { organizationId, idempotencyKey, error });
    throw error;
  }
}

/**
 * Check if a key is currently locked by another in-flight request.
 * This handles the case where two concurrent requests try to claim the same key.
 */
export async function isInFlight(
  organizationId: number,
  idempotencyKey: string,
): Promise<boolean> {
  const result = await query(
    `SELECT status FROM idempotency_keys
     WHERE organization_id = $1 AND idempotency_key = $2 AND expires_at > NOW()`,
    [organizationId, idempotencyKey],
  );

  if (result.rows.length === 0) return false;
  return result.rows[0].status === 'in_progress';
}

/**
 * Complete an idempotency key by storing the response.
 */
export async function completeKey(
  organizationId: number,
  idempotencyKey: string,
  responseStatus: number,
  responseBody: unknown,
): Promise<void> {
  await query(
    `UPDATE idempotency_keys
     SET status = 'completed', response_status = $3, response_body = $4
     WHERE organization_id = $1 AND idempotency_key = $2`,
    [organizationId, idempotencyKey, responseStatus, JSON.stringify(responseBody)],
  );
}

/**
 * Mark an idempotency key as failed (for error responses).
 */
export async function failKey(
  organizationId: number,
  idempotencyKey: string,
  responseStatus: number,
  responseBody: unknown,
): Promise<void> {
  await query(
    `UPDATE idempotency_keys
     SET status = 'failed', response_status = $3, response_body = $4
     WHERE organization_id = $1 AND idempotency_key = $2`,
    [organizationId, idempotencyKey, responseStatus, JSON.stringify(responseBody)],
  );
}

/**
 * Clean up expired idempotency keys.
 * Called periodically or on startup.
 */
export async function cleanupExpired(): Promise<number> {
  const result = await query(
    `DELETE FROM idempotency_keys WHERE expires_at < NOW()`,
  );
  const deleted = result.rowCount ?? 0;
  if (deleted > 0) {
    logger.info(`Cleaned up ${deleted} expired idempotency keys`);
  }
  return deleted;
}
