import {
  claimKey,
  completeKey,
  failKey,
  isInFlight,
  cleanupExpired,
  IdempotencyConflictError,
} from '../idempotencyService.js';
import { query } from '../../config/database.js';

jest.mock('../../config/database.js');
jest.mock('../../utils/logger.js');

describe('idempotencyService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('claimKey', () => {
    it('should insert a new key with in_progress status', async () => {
      // INSERT succeeds (rowCount 1) — no follow-up queries needed.
      (query as jest.Mock).mockResolvedValueOnce({ rowCount: 1, rows: [] });

      const result = await claimKey(1, 'key-1');

      expect(result).toBeNull();
      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO idempotency_keys'), [
        1,
        'key-1',
        expect.any(Date),
      ]);
    });

    it('should return existing completed record for replay', async () => {
      const storedResponse = { success: true };
      // INSERT misses (row exists, not expired). UPDATE misses (not expired). SELECT returns completed.
      (query as jest.Mock)
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              organization_id: 1,
              idempotency_key: 'replay-key',
              status: 'completed',
              response_status: 201,
              response_body: storedResponse,
              created_at: new Date(),
              expires_at: new Date(Date.now() + 3600000),
            },
          ],
        });

      const result = await claimKey(1, 'replay-key');

      expect(result).not.toBeNull();
      expect(result!.status).toBe('completed');
      expect(result!.responseStatus).toBe(201);
      expect(result!.responseBody).toEqual(storedResponse);
    });

    it('should return existing failed record for replay', async () => {
      (query as jest.Mock)
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 2,
              organization_id: 1,
              idempotency_key: 'fail-key',
              status: 'failed',
              response_status: 400,
              response_body: { error: 'Bad Request' },
              created_at: new Date(),
              expires_at: new Date(Date.now() + 3600000),
            },
          ],
        });

      const result = await claimKey(1, 'fail-key');

      expect(result).not.toBeNull();
      expect(result!.status).toBe('failed');
    });

    it('should overwrite expired in_progress keys', async () => {
      // INSERT misses (expired row exists). UPDATE claims the expired in_progress row.
      (query as jest.Mock)
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] });

      const result = await claimKey(1, 'expired-key');

      expect(result).toBeNull();
      expect(query).toHaveBeenCalledTimes(2);
    });

    it('should throw IdempotencyConflictError for concurrent duplicate', async () => {
      // INSERT misses (row exists). UPDATE misses (not expired). SELECT returns in_progress.
      (query as jest.Mock)
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 5,
              organization_id: 1,
              idempotency_key: 'racing-key',
              status: 'in_progress',
              response_status: null,
              response_body: null,
              created_at: new Date(),
              expires_at: new Date(Date.now() + 3600000),
            },
          ],
        });

      await expect(claimKey(1, 'racing-key')).rejects.toThrow(IdempotencyConflictError);
    });

    it('should handle two simultaneous claims — one wins, one throws', async () => {
      // Simulate a race: first call inserts successfully, second call finds in_progress.
      let callCount = 0;
      (query as jest.Mock).mockImplementation(async (sql: string) => {
        callCount++;
        if (callCount === 1) {
          // First claim: INSERT succeeds
          return { rowCount: 1, rows: [] };
        }
        if (callCount === 2) {
          // Second claim: INSERT misses (row now exists)
          return { rowCount: 0, rows: [] };
        }
        if (callCount === 3) {
          // Second claim: UPDATE misses (not expired)
          return { rowCount: 0, rows: [] };
        }
        if (callCount === 4) {
          // Second claim: SELECT returns in_progress
          return {
            rows: [
              {
                id: 10,
                organization_id: 1,
                idempotency_key: 'race-key',
                status: 'in_progress',
                response_status: null,
                response_body: null,
                created_at: new Date(),
                expires_at: new Date(Date.now() + 3600000),
              },
            ],
          };
        }
        return { rowCount: 0, rows: [] };
      });

      // Fire both claims in parallel.
      const [result1, result2] = await Promise.allSettled([
        claimKey(1, 'race-key'),
        claimKey(1, 'race-key'),
      ]);

      // Exactly one should succeed (null = "proceed"), the other should throw.
      const fulfilled = [result1, result2].filter((r) => r.status === 'fulfilled');
      const rejected = [result1, result2].filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((fulfilled[0] as PromiseFulfilledResult<any>).value).toBeNull();
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        IdempotencyConflictError
      );
    });
  });

  describe('isInFlight', () => {
    it('should return true when key is in_progress', async () => {
      (query as jest.Mock).mockResolvedValue({
        rows: [{ status: 'in_progress' }],
      });

      const result = await isInFlight(1, 'flight-key');
      expect(result).toBe(true);
    });

    it('should return false when key is completed', async () => {
      (query as jest.Mock).mockResolvedValue({
        rows: [{ status: 'completed' }],
      });

      const result = await isInFlight(1, 'done-key');
      expect(result).toBe(false);
    });

    it('should return false when key does not exist', async () => {
      (query as jest.Mock).mockResolvedValue({ rows: [] });

      const result = await isInFlight(1, 'missing-key');
      expect(result).toBe(false);
    });
  });

  describe('completeKey', () => {
    it('should update status to completed with response', async () => {
      (query as jest.Mock).mockResolvedValue({ rowCount: 1 });

      await completeKey(1, 'done-key', 201, { id: 42 });

      expect(query).toHaveBeenCalledWith(expect.stringContaining("SET status = 'completed'"), [
        1,
        'done-key',
        201,
        '{"id":42}',
      ]);
    });
  });

  describe('failKey', () => {
    it('should update status to failed with response', async () => {
      (query as jest.Mock).mockResolvedValue({ rowCount: 1 });

      await failKey(1, 'err-key', 400, { error: 'Bad Request' });

      expect(query).toHaveBeenCalledWith(expect.stringContaining("SET status = 'failed'"), [
        1,
        'err-key',
        400,
        '{"error":"Bad Request"}',
      ]);
    });
  });

  describe('cleanupExpired', () => {
    it('should delete expired keys', async () => {
      (query as jest.Mock).mockResolvedValue({ rowCount: 5 });

      const deleted = await cleanupExpired();

      expect(deleted).toBe(5);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM idempotency_keys WHERE expires_at')
      );
    });

    it('should return 0 when nothing to clean', async () => {
      (query as jest.Mock).mockResolvedValue({ rowCount: 0 });

      const deleted = await cleanupExpired();
      expect(deleted).toBe(0);
    });
  });
});
