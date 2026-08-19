import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import pool from '../config/database.js';
import { tenantQuotaService } from '../services/tenantQuotaService.js';
import { auditIntegrityService } from '../services/auditIntegrityService.js';
import logger from '../utils/logger.js';

// Advisory lock IDs — arbitrary but stable; chosen to avoid collisions
// with any other pg_advisory_lock usage in the application.
const ADVISORY_LOCK_USAGE_SNAPSHOT = 84_901_001;
const ADVISORY_LOCK_INTEGRITY_CHECK = 84_901_002;

/**
 * Daily-part-49 jobs — leader-elected, cron-scheduled.
 *
 * scheduleDailyUsageSnapshots() and scheduleNightlyIntegrityCheck() each:
 *   1. Run once immediately on startup (catches missed windows after deploys).
 *   2. Schedule a node-cron job at midnight UTC (0 0 * * *).
 *   3. On each cron tick, attempt a Postgres advisory lock so only one pod
 *      in the replica set actually executes the job.
 *
 * Usage in index.ts / server bootstrap:
 *   const usageSnapshots = scheduleDailyUsageSnapshots();
 *   const integrityCheck = scheduleNightlyIntegrityCheck();
 *   // on shutdown: usageSnapshots.stop(); integrityCheck.stop();
 */

export interface ScheduledJob {
  stop(): void;
}

export function scheduleDailyUsageSnapshots(): ScheduledJob {
  // Run once immediately on startup (non-leader-elected — safe idempotent catch-up)
  void runDailyUsageSnapshots();

  const task: ScheduledTask = cron.schedule('0 0 * * *', () => {
    void runWithAdvisoryLock(ADVISORY_LOCK_USAGE_SNAPSHOT, 'daily-usage-snapshot', runDailyUsageSnapshots);
  }, { timezone: 'UTC' });

  logger.info('Daily usage snapshot cron scheduled (midnight UTC, leader-elected)');

  return {
    stop() {
      task.stop();
      logger.info('Daily usage snapshot cron stopped');
    },
  };
}

export function scheduleNightlyIntegrityCheck(): ScheduledJob {
  void runNightlyIntegrityCheck();

  const task: ScheduledTask = cron.schedule('0 0 * * *', () => {
    void runWithAdvisoryLock(ADVISORY_LOCK_INTEGRITY_CHECK, 'nightly-integrity-check', runNightlyIntegrityCheck);
  }, { timezone: 'UTC' });

  logger.info('Nightly integrity check cron scheduled (midnight UTC, leader-elected)');

  return {
    stop() {
      task.stop();
      logger.info('Nightly integrity check cron stopped');
    },
  };
}

/**
 * Try to acquire a Postgres advisory lock. If this pod wins the lock,
 * execute the job and release; otherwise skip silently.
 *
 * pg_try_advisory_lock is non-blocking and session-scoped: it releases
 * automatically when the client connection returns to the pool.
 */
async function runWithAdvisoryLock(
  lockId: number,
  jobName: string,
  job: () => Promise<void>,
): Promise<void> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS acquired',
      [lockId],
    );

    if (!rows[0].acquired) {
      logger.debug(`[${jobName}] Lock held by another pod — skipping`);
      return;
    }

    logger.info(`[${jobName}] Acquired advisory lock — executing`);
    await job();
  } catch (err) {
    logger.error(`[${jobName}] Error during leader-elected execution`, { err });
  } finally {
    client.release();
  }
}

async function runDailyUsageSnapshots(): Promise<void> {
  logger.info('Starting daily tenant usage snapshot job');
  try {
    await tenantQuotaService.snapshotAllTenants();
    logger.info('Daily tenant usage snapshot job completed');
  } catch (err) {
    logger.error('Daily tenant usage snapshot job failed', { err });
  }
}

async function runNightlyIntegrityCheck(): Promise<void> {
  logger.info('Starting nightly audit log integrity check');
  try {
    await auditIntegrityService.runScheduledCheck();
  } catch (err) {
    logger.error('Nightly audit integrity check failed', { err });
  }
}
