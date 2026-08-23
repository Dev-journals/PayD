/**
 * Unit tests for the TOTP two-factor service.
 *
 * The database layer is mocked, so no live PostgreSQL is required. Queries are
 * routed by matching against the SQL text rather than by call order, which
 * keeps the tests readable and insensitive to incidental reordering.
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

const {
  RECOVERY_CODE_COUNT,
  TwoFactorError,
  confirmSetup,
  disable,
  generateRecoveryCodes,
  getStatus,
  hashRecoveryCode,
  normalizeRecoveryCode,
  startSetup,
  verifySecondFactor,
} = await import('../twoFactorService.js');

type QueryResult = { rows: any[]; rowCount?: number };
type Route = [RegExp, (params: any[]) => QueryResult];

/** Routes each mocked query to the first handler whose pattern matches. */
function route(...routes: Route[]) {
  mockQuery.mockImplementation(async (sql: string, params: any[] = []) => {
    for (const [pattern, handler] of routes) {
      if (pattern.test(sql)) return handler(params);
    }
    return { rows: [], rowCount: 0 };
  });
}

/** Every SQL statement the service issued, in order. */
function issuedSql(): string[] {
  return mockQuery.mock.calls.map((call: any[]) => String(call[0]));
}

function sqlMatching(pattern: RegExp): string[] {
  return issuedSql().filter((sql) => pattern.test(sql));
}

const SELECT_USER = /SELECT id, wallet_address, email, role/;
const COUNT_CODES = /SELECT COUNT\(\*\)/;
const UPDATE_STEP = /SET totp_last_used_step = \$2/;
const CONSUME_RECOVERY = /UPDATE user_recovery_codes/;
const INSERT_RECOVERY = /INSERT INTO user_recovery_codes/;
const RECORD_FAILURE = /two_factor_failed_attempts \+ 1/;

function userRow(overrides: Record<string, any> = {}) {
  return {
    id: 42,
    wallet_address: 'GADMIN',
    email: 'admin@payd.test',
    role: 'ADMIN',
    is_2fa_enabled: false,
    totp_secret: null,
    totp_pending_secret: null,
    two_factor_enabled_at: null,
    two_factor_locked_until: null,
    // Computed by the database with the database's clock, never in JS.
    is_locked: false,
    ...overrides,
  };
}

/**
 * Runs enrolment far enough to learn both the plaintext secret (for generating
 * valid codes) and the encrypted blob the service persisted.
 *
 * QR generation is slow, so the pair is produced once and shared: the tests
 * only need *a* valid secret, not a distinct one each time.
 */
let enrolment: Promise<{ secret: string; encrypted: string }> | null = null;

async function enrol(): Promise<{ secret: string; encrypted: string }> {
  if (!enrolment) {
    enrolment = (async () => {
      route([SELECT_USER, () => ({ rows: [userRow()], rowCount: 1 })]);

      const { secret } = await startSetup(42);
      const update = mockQuery.mock.calls.find((call: any[]) =>
        /totp_pending_secret = \$2/.test(String(call[0]))
      ) as any[];

      return { secret, encrypted: update[1][1] };
    })();
  }

  const result = await enrolment;
  mockQuery.mockReset();
  return result;
}

describe('twoFactorService', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  describe('recovery codes', () => {
    it('generates exactly 8 codes by default', () => {
      expect(RECOVERY_CODE_COUNT).toBe(8);
      expect(generateRecoveryCodes()).toHaveLength(8);
    });

    it('generates distinct, readable, unambiguous codes', () => {
      const codes = generateRecoveryCodes();

      expect(new Set(codes).size).toBe(8);
      for (const code of codes) {
        expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
      }
    });

    it('hashes case- and format-insensitively so codes can be typed back loosely', () => {
      expect(normalizeRecoveryCode('abcde-fghij')).toBe('ABCDEFGHIJ');
      expect(hashRecoveryCode('abcde-fghij')).toBe(hashRecoveryCode('ABCDE FGHIJ'));
    });

    it('never stores a recovery code in a recoverable form', () => {
      const hash = hashRecoveryCode('ABCDE-FGHIJ');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(hash).not.toContain('ABCDE');
    });
  });

  describe('startSetup', () => {
    it('returns a scannable QR code and otpauth URL without enabling 2FA', async () => {
      route([SELECT_USER, () => ({ rows: [userRow()], rowCount: 1 })]);

      const setup = await startSetup(42);

      expect(setup.qrCode).toMatch(/^data:image\/png;base64,/);
      expect(setup.otpauthUrl).toContain('otpauth://totp/');
      expect(setup.otpauthUrl).toContain('issuer=PayD');
      expect(setup.otpauthUrl).toContain(encodeURIComponent(setup.secret));
      // The secret must land in the *pending* column only.
      expect(sqlMatching(/totp_pending_secret = \$2/)).toHaveLength(1);
      expect(sqlMatching(/is_2fa_enabled = TRUE/)).toHaveLength(0);
    });

    it('encrypts the secret before it reaches the database', async () => {
      route([SELECT_USER, () => ({ rows: [userRow()], rowCount: 1 })]);

      const { secret } = await startSetup(42);
      const stored = (
        mockQuery.mock.calls.find((call: any[]) =>
          /totp_pending_secret = \$2/.test(String(call[0]))
        ) as any[]
      )[1][1];

      expect(stored).not.toContain(secret);
      expect(stored.startsWith('v1.')).toBe(true);
    });

    it('refuses to re-enrol while 2FA is already enabled', async () => {
      route([SELECT_USER, () => ({ rows: [userRow({ is_2fa_enabled: true })], rowCount: 1 })]);

      await expect(startSetup(42)).rejects.toMatchObject({ status: 409, code: 'ALREADY_ENABLED' });
    });

    it('reports a 404 for an unknown user', async () => {
      route([SELECT_USER, () => ({ rows: [], rowCount: 0 })]);

      await expect(startSetup(999)).rejects.toBeInstanceOf(TwoFactorError);
    });
  });

  describe('confirmSetup', () => {
    it('enables 2FA and issues 8 recovery codes for a valid code', async () => {
      const { secret, encrypted } = await enrol();

      route(
        [SELECT_USER, () => ({ rows: [userRow({ totp_pending_secret: encrypted })], rowCount: 1 })],
        [UPDATE_STEP, () => ({ rows: [{ id: 42 }], rowCount: 1 })]
      );

      const codes = await confirmSetup(42, authenticator.generate(secret));

      expect(codes).toHaveLength(8);
      expect(sqlMatching(/is_2fa_enabled = TRUE/)).toHaveLength(1);
      expect(sqlMatching(INSERT_RECOVERY)).toHaveLength(1);

      // Only hashes are persisted — never the plaintext codes.
      const insert = mockQuery.mock.calls.find((call: any[]) =>
        INSERT_RECOVERY.test(String(call[0]))
      ) as any[];
      expect(insert[1][1]).toEqual(codes.map(hashRecoveryCode));
      expect(insert[1][1]).not.toContain(codes[0]);
    });

    it('rejects an invalid code and leaves 2FA disabled', async () => {
      const { encrypted } = await enrol();

      route(
        [SELECT_USER, () => ({ rows: [userRow({ totp_pending_secret: encrypted })], rowCount: 1 })],
        [UPDATE_STEP, () => ({ rows: [{ id: 42 }], rowCount: 1 })]
      );

      await expect(confirmSetup(42, '000000')).rejects.toMatchObject({
        status: 401,
        code: 'INVALID_CODE',
      });
      expect(sqlMatching(/is_2fa_enabled = TRUE/)).toHaveLength(0);
      expect(sqlMatching(RECORD_FAILURE)).toHaveLength(1);
    });

    it('refuses to enable 2FA when setup was never started', async () => {
      route([SELECT_USER, () => ({ rows: [userRow()], rowCount: 1 })]);

      await expect(confirmSetup(42, '123456')).rejects.toMatchObject({
        status: 400,
        code: 'SETUP_NOT_STARTED',
      });
      expect(sqlMatching(/is_2fa_enabled = TRUE/)).toHaveLength(0);
    });
  });

  describe('verifySecondFactor', () => {
    it('accepts a current TOTP code', async () => {
      const { secret, encrypted } = await enrol();

      route(
        [
          SELECT_USER,
          () => ({
            rows: [userRow({ is_2fa_enabled: true, totp_secret: encrypted })],
            rowCount: 1,
          }),
        ],
        [UPDATE_STEP, () => ({ rows: [{ id: 42 }], rowCount: 1 })]
      );

      await expect(verifySecondFactor(42, authenticator.generate(secret))).resolves.toEqual({
        usedRecoveryCode: false,
      });
    });

    it('rejects a TOTP code that was already spent', async () => {
      const { secret, encrypted } = await enrol();

      route(
        [
          SELECT_USER,
          () => ({
            rows: [userRow({ is_2fa_enabled: true, totp_secret: encrypted })],
            rowCount: 1,
          }),
        ],
        // The guarded UPDATE matches no row when the step was already burned.
        [UPDATE_STEP, () => ({ rows: [], rowCount: 0 })]
      );

      await expect(verifySecondFactor(42, authenticator.generate(secret))).rejects.toMatchObject({
        status: 401,
        code: 'INVALID_CODE',
      });
    });

    it('accepts an unused recovery code and marks it consumed', async () => {
      const { encrypted } = await enrol();

      route(
        [
          SELECT_USER,
          () => ({
            rows: [userRow({ is_2fa_enabled: true, totp_secret: encrypted })],
            rowCount: 1,
          }),
        ],
        [CONSUME_RECOVERY, () => ({ rows: [{ id: 7 }], rowCount: 1 })]
      );

      await expect(verifySecondFactor(42, 'abcde-fghij')).resolves.toEqual({
        usedRecoveryCode: true,
      });

      const consume = mockQuery.mock.calls.find((call: any[]) =>
        CONSUME_RECOVERY.test(String(call[0]))
      ) as any[];
      expect(consume[0]).toContain('used_at IS NULL');
      expect(consume[1][1]).toBe(hashRecoveryCode('abcde-fghij'));
    });

    it('rejects a recovery code that was already redeemed', async () => {
      const { encrypted } = await enrol();

      route(
        [
          SELECT_USER,
          () => ({
            rows: [userRow({ is_2fa_enabled: true, totp_secret: encrypted })],
            rowCount: 1,
          }),
        ],
        [CONSUME_RECOVERY, () => ({ rows: [], rowCount: 0 })]
      );

      await expect(verifySecondFactor(42, 'abcde-fghij')).rejects.toMatchObject({
        status: 401,
        code: 'INVALID_CODE',
      });
    });

    it('refuses verification for an account without 2FA', async () => {
      route([SELECT_USER, () => ({ rows: [userRow()], rowCount: 1 })]);

      await expect(verifySecondFactor(42, '123456')).rejects.toMatchObject({
        status: 400,
        code: 'NOT_ENABLED',
      });
    });

    it('locks out verification while the account is in cool-off', async () => {
      const { encrypted } = await enrol();

      route([
        SELECT_USER,
        () => ({
          rows: [
            userRow({
              is_2fa_enabled: true,
              totp_secret: encrypted,
              two_factor_locked_until: new Date(Date.now() + 60_000),
              is_locked: true,
            }),
          ],
          rowCount: 1,
        }),
      ]);

      await expect(verifySecondFactor(42, '123456')).rejects.toMatchObject({
        status: 429,
        code: 'TWO_FACTOR_LOCKED',
      });
    });

    it('asks the database whether the account is locked', async () => {
      route([SELECT_USER, () => ({ rows: [userRow()], rowCount: 1 })]);

      await expect(verifySecondFactor(42, '123456')).rejects.toBeInstanceOf(TwoFactorError);

      // The lock decision has to be computed by Postgres against its own clock.
      const select = sqlMatching(SELECT_USER)[0];
      expect(select).toContain('two_factor_locked_until > NOW()');
      expect(select).toContain('AS is_locked');
    });

    it('stays locked even when the stored timestamp reads as past locally', async () => {
      // Regression: two_factor_locked_until used to be a bare TIMESTAMP, which
      // node-pg parses as *local* time. On a server east of UTC the value came
      // back in the past, so a JS-side comparison silently skipped the lockout
      // and brute-force attempts sailed through. The column is TIMESTAMPTZ now,
      // and the decision comes from the database either way.
      const { encrypted } = await enrol();

      route([
        SELECT_USER,
        () => ({
          rows: [
            userRow({
              is_2fa_enabled: true,
              totp_secret: encrypted,
              two_factor_locked_until: new Date(Date.now() - 60 * 60_000),
              is_locked: true,
            }),
          ],
          rowCount: 1,
        }),
      ]);

      await expect(verifySecondFactor(42, '123456')).rejects.toMatchObject({
        status: 429,
        code: 'TWO_FACTOR_LOCKED',
      });
    });

    it('restarts the failure count after a lockout has expired', async () => {
      const { encrypted } = await enrol();

      route([
        SELECT_USER,
        () => ({
          rows: [
            userRow({
              is_2fa_enabled: true,
              totp_secret: encrypted,
              two_factor_locked_until: new Date(Date.now() - 60_000),
            }),
          ],
          rowCount: 1,
        }),
      ]);

      await expect(verifySecondFactor(42, '000000')).rejects.toMatchObject({
        status: 401,
        code: 'INVALID_CODE',
      });

      // Serving one cool-off must not leave the account one mistake from the next.
      const failure = sqlMatching(RECORD_FAILURE)[0];
      expect(failure).toContain('two_factor_locked_until <= NOW() THEN 1');
    });

    it('ignores a lockout that has already expired', async () => {
      const { secret, encrypted } = await enrol();

      route(
        [
          SELECT_USER,
          () => ({
            rows: [
              userRow({
                is_2fa_enabled: true,
                totp_secret: encrypted,
                two_factor_locked_until: new Date(Date.now() - 60_000),
                is_locked: false,
              }),
            ],
            rowCount: 1,
          }),
        ],
        [UPDATE_STEP, () => ({ rows: [{ id: 42 }], rowCount: 1 })]
      );

      await expect(verifySecondFactor(42, authenticator.generate(secret))).resolves.toEqual({
        usedRecoveryCode: false,
      });
    });
  });

  describe('disable', () => {
    it('clears the secret and recovery codes for a valid TOTP code', async () => {
      const { secret, encrypted } = await enrol();

      route(
        [
          SELECT_USER,
          () => ({
            rows: [userRow({ is_2fa_enabled: true, totp_secret: encrypted })],
            rowCount: 1,
          }),
        ],
        [UPDATE_STEP, () => ({ rows: [{ id: 42 }], rowCount: 1 })]
      );

      await disable(42, authenticator.generate(secret));

      expect(sqlMatching(/is_2fa_enabled = FALSE/)).toHaveLength(1);
      expect(sqlMatching(/DELETE FROM user_recovery_codes/)).toHaveLength(1);
      const clear = sqlMatching(/is_2fa_enabled = FALSE/)[0];
      expect(clear).toContain('totp_secret = NULL');
    });

    it('refuses to disable without a valid current TOTP code', async () => {
      const { encrypted } = await enrol();

      route(
        [
          SELECT_USER,
          () => ({
            rows: [userRow({ is_2fa_enabled: true, totp_secret: encrypted })],
            rowCount: 1,
          }),
        ],
        [UPDATE_STEP, () => ({ rows: [{ id: 42 }], rowCount: 1 })]
      );

      await expect(disable(42, '000000')).rejects.toMatchObject({
        status: 401,
        code: 'INVALID_CODE',
      });
      expect(sqlMatching(/is_2fa_enabled = FALSE/)).toHaveLength(0);
    });

    it('does not accept a recovery code in place of a TOTP code', async () => {
      const { encrypted } = await enrol();

      route(
        [
          SELECT_USER,
          () => ({
            rows: [userRow({ is_2fa_enabled: true, totp_secret: encrypted })],
            rowCount: 1,
          }),
        ],
        [CONSUME_RECOVERY, () => ({ rows: [{ id: 7 }], rowCount: 1 })]
      );

      await expect(disable(42, 'abcde-fghij')).rejects.toMatchObject({
        status: 401,
        code: 'INVALID_CODE',
      });
      expect(sqlMatching(CONSUME_RECOVERY)).toHaveLength(0);
      expect(sqlMatching(/is_2fa_enabled = FALSE/)).toHaveLength(0);
    });

    it('refuses when 2FA is not enabled', async () => {
      route([SELECT_USER, () => ({ rows: [userRow()], rowCount: 1 })]);

      await expect(disable(42, '123456')).rejects.toMatchObject({
        status: 400,
        code: 'NOT_ENABLED',
      });
    });
  });

  describe('getStatus', () => {
    it('reports enrolment state without leaking the secret', async () => {
      const enabledAt = new Date('2026-01-02T03:04:05Z');

      route(
        [
          SELECT_USER,
          () => ({
            rows: [
              userRow({
                is_2fa_enabled: true,
                totp_secret: 'v1.secret',
                two_factor_enabled_at: enabledAt,
              }),
            ],
            rowCount: 1,
          }),
        ],
        [COUNT_CODES, () => ({ rows: [{ count: 6 }], rowCount: 1 })]
      );

      const status = await getStatus(42);

      expect(status).toEqual({
        enabled: true,
        enabledAt: enabledAt.toISOString(),
        setupPending: false,
        recoveryCodesRemaining: 6,
      });
      expect(JSON.stringify(status)).not.toContain('secret');
    });

    it('flags a setup that was started but never confirmed', async () => {
      route(
        [
          SELECT_USER,
          () => ({ rows: [userRow({ totp_pending_secret: 'v1.pending' })], rowCount: 1 }),
        ],
        [COUNT_CODES, () => ({ rows: [{ count: 0 }], rowCount: 1 })]
      );

      await expect(getStatus(42)).resolves.toMatchObject({ enabled: false, setupPending: true });
    });
  });
});
