/**
 * Behavioural tests for the 2FA guarantees that only show up across a sequence
 * of calls: the brute-force lockout threshold, and single-use enforcement under
 * concurrency.
 *
 * These run against a small in-memory stand-in for the two tables the service
 * touches, which implements the exact semantics of the guarded statements the
 * service issues (`UPDATE … WHERE used_at IS NULL`,
 * `UPDATE … WHERE totp_last_used_step < $2`, and the failure-counter CASE).
 * The stand-in models Postgres; it is not proof that Postgres behaves this way.
 * The companion assertions in twoFactorService.test.ts pin the guard clauses to
 * the SQL text, so a change that dropped a guard fails there.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { authenticator } from '@otplib/preset-default';

// QR-code generation and the first ts-jest transform are slow enough that the
// 5s default can trip on a loaded machine.
jest.setTimeout(30_000);

const mockQuery = jest.fn<any>();

jest.unstable_mockModule('../../config/database.js', () => ({
  query: mockQuery,
  pool: { query: mockQuery },
  default: { query: mockQuery },
}));

const { confirmSetup, hashRecoveryCode, startSetup, verifySecondFactor, TwoFactorError } =
  await import('../twoFactorService.js');

const USER_ID = 42;
const MAX_FAILED_ATTEMPTS = 5;

interface FakeUser {
  id: number;
  wallet_address: string | null;
  email: string | null;
  role: string;
  is_2fa_enabled: boolean;
  totp_secret: string | null;
  totp_pending_secret: string | null;
  two_factor_enabled_at: Date | null;
  two_factor_locked_until: Date | null;
  totp_last_used_step: number | null;
  two_factor_failed_attempts: number;
}

/**
 * In-memory stand-in for the `users` and `user_recovery_codes` rows, applying
 * the same guards the service's SQL applies.
 */
function installFakeDatabase() {
  const user: FakeUser = {
    id: USER_ID,
    wallet_address: 'GADMIN',
    email: 'admin@payd.test',
    role: 'ADMIN',
    is_2fa_enabled: false,
    totp_secret: null,
    totp_pending_secret: null,
    two_factor_enabled_at: null,
    two_factor_locked_until: null,
    totp_last_used_step: null,
    two_factor_failed_attempts: 0,
  };

  const recoveryCodes = new Map<string, { used: boolean }>();

  mockQuery.mockImplementation(async (sql: string, params: any[] = []) => {
    // Yield to the event loop so genuinely interleaved callers race here, the
    // way concurrent requests race on a real connection pool.
    await Promise.resolve();

    if (/SELECT id, wallet_address, email, role/.test(sql)) {
      const lockedUntil = user.two_factor_locked_until;
      return {
        rows: [
          {
            ...user,
            // The database computes this against its own clock.
            is_locked: lockedUntil !== null && lockedUntil.getTime() > Date.now(),
          },
        ],
        rowCount: 1,
      };
    }

    if (/SELECT COUNT\(\*\)/.test(sql)) {
      const unused = [...recoveryCodes.values()].filter((c) => !c.used).length;
      return { rows: [{ count: unused }], rowCount: 1 };
    }

    // UPDATE users SET totp_last_used_step = $2 WHERE id = $1
    //   AND (totp_last_used_step IS NULL OR totp_last_used_step < $2)
    if (/SET totp_last_used_step = \$2/.test(sql)) {
      const step = Number(params[1]);
      if (user.totp_last_used_step === null || user.totp_last_used_step < step) {
        user.totp_last_used_step = step;
        return { rows: [{ id: USER_ID }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    // UPDATE user_recovery_codes SET used_at = NOW() … AND used_at IS NULL
    if (/UPDATE user_recovery_codes/.test(sql)) {
      const record = recoveryCodes.get(params[1]);
      if (record && !record.used) {
        record.used = true;
        return { rows: [{ id: 1 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    // Branch order matters: several of these statements also reset the failure
    // counter, so the most specific pattern has to be tested first.
    if (/is_2fa_enabled = TRUE/.test(sql)) {
      user.totp_secret = user.totp_pending_secret;
      user.totp_pending_secret = null;
      user.is_2fa_enabled = true;
      user.two_factor_enabled_at = new Date();
      user.two_factor_failed_attempts = 0;
      user.two_factor_locked_until = null;
      return { rows: [], rowCount: 1 };
    }

    // Checked before the counter branches: startSetup's UPDATE also resets
    // two_factor_failed_attempts, so it would otherwise match one of them.
    if (/totp_pending_secret = \$2/.test(sql)) {
      user.totp_pending_secret = params[1];
      return { rows: [], rowCount: 1 };
    }

    // The failure-counter CASE.
    if (/two_factor_failed_attempts \+ 1/.test(sql)) {
      const maxAttempts = Number(params[1]);
      const lockoutMs = Number(params[2]);
      const lockedUntil = user.two_factor_locked_until;
      const lockExpired = lockedUntil !== null && lockedUntil.getTime() <= Date.now();

      if (lockExpired) {
        user.two_factor_failed_attempts = 1;
        user.two_factor_locked_until = null;
      } else {
        user.two_factor_failed_attempts += 1;
        if (user.two_factor_failed_attempts >= maxAttempts) {
          user.two_factor_locked_until = new Date(Date.now() + lockoutMs);
        }
      }
      return { rows: [], rowCount: 1 };
    }

    if (/two_factor_failed_attempts = 0/.test(sql)) {
      user.two_factor_failed_attempts = 0;
      user.two_factor_locked_until = null;
      return { rows: [], rowCount: 1 };
    }

    if (/DELETE FROM user_recovery_codes/.test(sql)) {
      recoveryCodes.clear();
      return { rows: [], rowCount: 0 };
    }

    if (/INSERT INTO user_recovery_codes/.test(sql)) {
      for (const hash of params[1] as string[]) recoveryCodes.set(hash, { used: false });
      return { rows: [], rowCount: (params[1] as string[]).length };
    }

    return { rows: [], rowCount: 0 };
  });

  return { user, recoveryCodes };
}

/** Enrols the fake admin and returns the secret plus the issued codes. */
async function enrolFully() {
  const { secret } = await startSetup(USER_ID);
  const codes = await confirmSetup(USER_ID, authenticator.generate(secret));
  return { secret, codes };
}

/**
 * Accepted TOTP codes are burned, so a test needing a second valid code has to
 * reach the next 30-second step. Waiting for it in real time would make the
 * suite crawl, so the clock is moved forward instead — both otplib and the
 * service read the same `Date.now`, so they stay consistent.
 */
const TOTP_STEP_SECONDS = 30;

const realNow = Date.now.bind(Date);
let clockOffset = 0;
Date.now = () => realNow() + clockOffset;

const nextStepCode = (secret: string): string => {
  clockOffset += (TOTP_STEP_SECONDS + 1) * 1000;
  return authenticator.generate(secret);
};

describe('twoFactorService — behaviour across calls', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    clockOffset = 0;
  });

  describe('brute-force lockout', () => {
    it('locks verification on the fifth consecutive failure', async () => {
      installFakeDatabase();
      const { secret } = await enrolFully();

      // The first four failures are reported as bad codes, not as a lockout.
      for (let attempt = 1; attempt < MAX_FAILED_ATTEMPTS; attempt++) {
        await expect(verifySecondFactor(USER_ID, '000000')).rejects.toMatchObject({
          code: 'INVALID_CODE',
          status: 401,
        });
      }

      // The fifth failure trips the lock.
      await expect(verifySecondFactor(USER_ID, '000000')).rejects.toMatchObject({
        code: 'INVALID_CODE',
        status: 401,
      });

      // A genuinely valid code is now refused with 429 rather than accepted.
      await expect(verifySecondFactor(USER_ID, nextStepCode(secret))).rejects.toMatchObject({
        code: 'TWO_FACTOR_LOCKED',
        status: 429,
      });
    });

    it('clears the failure count after a successful verification', async () => {
      installFakeDatabase();
      const { secret } = await enrolFully();

      for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS - 1; attempt++) {
        await expect(verifySecondFactor(USER_ID, '000000')).rejects.toBeInstanceOf(TwoFactorError);
      }

      await expect(verifySecondFactor(USER_ID, nextStepCode(secret))).resolves.toEqual({
        usedRecoveryCode: false,
      });

      // Four more failures must not lock, because the counter was reset.
      for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS - 1; attempt++) {
        await expect(verifySecondFactor(USER_ID, '000000')).rejects.toMatchObject({
          code: 'INVALID_CODE',
        });
      }
    });
  });

  describe('single use under concurrency', () => {
    it('accepts a recovery code exactly once across concurrent requests', async () => {
      installFakeDatabase();
      const { codes } = await enrolFully();

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () => verifySecondFactor(USER_ID, codes[0]))
      );

      const accepted = results.filter((r) => r.status === 'fulfilled');
      expect(accepted).toHaveLength(1);
      expect((accepted[0] as PromiseFulfilledResult<any>).value).toEqual({
        usedRecoveryCode: true,
      });
    });

    it('accepts a TOTP code exactly once across concurrent requests', async () => {
      installFakeDatabase();
      const { secret } = await enrolFully();
      const code = nextStepCode(secret);

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () => verifySecondFactor(USER_ID, code))
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });

    it('leaves the other recovery codes usable', async () => {
      installFakeDatabase();
      const { codes } = await enrolFully();

      await expect(verifySecondFactor(USER_ID, codes[0])).resolves.toEqual({
        usedRecoveryCode: true,
      });
      await expect(verifySecondFactor(USER_ID, codes[1])).resolves.toEqual({
        usedRecoveryCode: true,
      });

      // …but neither of those two a second time.
      await expect(verifySecondFactor(USER_ID, codes[0])).rejects.toMatchObject({
        code: 'INVALID_CODE',
      });
    });

    it('stores only hashes, so the issued codes never appear in the table', async () => {
      const { recoveryCodes } = installFakeDatabase();
      const { codes } = await enrolFully();

      expect(recoveryCodes.size).toBe(8);
      expect([...recoveryCodes.keys()].sort()).toEqual(codes.map(hashRecoveryCode).sort());
      for (const code of codes) {
        expect(recoveryCodes.has(code)).toBe(false);
      }
    });
  });
});
