/**
 * Integration tests for the 2FA auth endpoints.
 *
 * Passport and the database are mocked; JWTs are real, so the tests exercise
 * the actual authentication and role checks guarding these routes.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
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

// Passport is only needed so the OAuth routes can be registered.
jest.unstable_mockModule('passport', () => ({
  default: {
    authenticate: () => (_req: any, _res: any, next: any) => next(),
    use: jest.fn(),
    serializeUser: jest.fn(),
    deserializeUser: jest.fn(),
  },
}));

const { config } = await import('../../config/env.js');
const authRoutes = (await import('../../routes/authRoutes.js')).default;
const { hashRecoveryCode } = await import('../../services/twoFactorService.js');
const { TOKEN_TYPE_2FA_CHALLENGE, TOKEN_TYPE_ACCESS } =
  await import('../../services/authService.js');

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

const ADMIN_ID = 42;

function userRow(overrides: Record<string, any> = {}) {
  return {
    id: ADMIN_ID,
    wallet_address: 'GADMIN',
    email: 'admin@payd.test',
    organization_id: 1,
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

function accessToken(role = 'ADMIN', id = ADMIN_ID) {
  return jwt.sign({ id, role, organizationId: 1, typ: TOKEN_TYPE_ACCESS }, config.JWT_SECRET, {
    expiresIn: '1h',
  });
}

type QueryResult = { rows: any[]; rowCount?: number };
type Route = [RegExp, (params: any[]) => QueryResult];

function route(...routes: Route[]) {
  mockQuery.mockImplementation(async (sql: string, params: any[] = []) => {
    for (const [pattern, handler] of routes) {
      if (pattern.test(sql)) return handler(params);
    }
    return { rows: [], rowCount: 0 };
  });
}

function issuedSql(): string[] {
  return mockQuery.mock.calls.map((call: any[]) => String(call[0]));
}

const SELECT_2FA_USER = /SELECT id, wallet_address, email, role/;
const SELECT_LOGIN_USER = /is_2fa_enabled FROM users WHERE wallet_address/;
const SELECT_SESSION_USER = /SELECT id, wallet_address, email, organization_id, role FROM users/;
const COUNT_CODES = /SELECT COUNT\(\*\)/;
const UPDATE_STEP = /SET totp_last_used_step = \$2/;
const CONSUME_RECOVERY = /UPDATE user_recovery_codes/;

/**
 * Enrols an admin and returns the secret plus the stored ciphertext.
 *
 * QR generation is slow, so the pair is produced once and shared: the tests
 * only need *a* valid secret, not a distinct one each time.
 */
let enrolment: Promise<{ secret: string; encrypted: string }> | null = null;

async function enrol(): Promise<{ secret: string; encrypted: string }> {
  if (!enrolment) {
    enrolment = (async () => {
      route([SELECT_2FA_USER, () => ({ rows: [userRow()], rowCount: 1 })]);

      const response = await request(app)
        .post('/api/auth/2fa/setup')
        .set('Authorization', `Bearer ${accessToken()}`);

      const update = mockQuery.mock.calls.find((call: any[]) =>
        /totp_pending_secret = \$2/.test(String(call[0]))
      ) as any[];

      return { secret: response.body.secret as string, encrypted: update[1][1] };
    })();
  }

  const result = await enrolment;
  mockQuery.mockReset();
  return result;
}

describe('Auth 2FA endpoints', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  describe('POST /api/auth/2fa/setup', () => {
    it('returns a QR code for the authenticated admin without enabling 2FA', async () => {
      route([SELECT_2FA_USER, () => ({ rows: [userRow()], rowCount: 1 })]);

      const response = await request(app)
        .post('/api/auth/2fa/setup')
        .set('Authorization', `Bearer ${accessToken()}`);

      expect(response.status).toBe(200);
      expect(response.body.qrCode).toMatch(/^data:image\/png;base64,/);
      expect(response.body.otpauthUrl).toContain('otpauth://totp/');
      expect(issuedSql().some((sql) => /is_2fa_enabled = TRUE/.test(sql))).toBe(false);
    });

    it('rejects unauthenticated callers', async () => {
      const response = await request(app).post('/api/auth/2fa/setup');

      expect(response.status).toBe(401);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('rejects non-privileged roles', async () => {
      const response = await request(app)
        .post('/api/auth/2fa/setup')
        .set('Authorization', `Bearer ${accessToken('EMPLOYEE')}`);

      expect(response.status).toBe(403);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('rejects a 2FA challenge token used as an access token', async () => {
      const challengeToken = jwt.sign(
        { id: ADMIN_ID, typ: TOKEN_TYPE_2FA_CHALLENGE },
        config.JWT_SECRET,
        { expiresIn: '5m' }
      );

      const response = await request(app)
        .post('/api/auth/2fa/setup')
        .set('Authorization', `Bearer ${challengeToken}`);

      expect(response.status).toBe(403);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/auth/2fa/verify', () => {
    it('enables 2FA and returns exactly 8 recovery codes', async () => {
      const { secret, encrypted } = await enrol();

      route(
        [
          SELECT_2FA_USER,
          () => ({ rows: [userRow({ totp_pending_secret: encrypted })], rowCount: 1 }),
        ],
        [UPDATE_STEP, () => ({ rows: [{ id: ADMIN_ID }], rowCount: 1 })]
      );

      const response = await request(app)
        .post('/api/auth/2fa/verify')
        .set('Authorization', `Bearer ${accessToken()}`)
        .send({ code: authenticator.generate(secret) });

      expect(response.status).toBe(200);
      expect(response.body.enabled).toBe(true);
      expect(response.body.recoveryCodes).toHaveLength(8);
      expect(response.body.recoveryCodeCount).toBe(8);
      expect(issuedSql().some((sql) => /is_2fa_enabled = TRUE/.test(sql))).toBe(true);
    });

    it('rejects an invalid code and leaves 2FA disabled', async () => {
      const { encrypted } = await enrol();

      route(
        [
          SELECT_2FA_USER,
          () => ({ rows: [userRow({ totp_pending_secret: encrypted })], rowCount: 1 }),
        ],
        [UPDATE_STEP, () => ({ rows: [{ id: ADMIN_ID }], rowCount: 1 })]
      );

      const response = await request(app)
        .post('/api/auth/2fa/verify')
        .set('Authorization', `Bearer ${accessToken()}`)
        .send({ code: '000000' });

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('INVALID_CODE');
      expect(response.body).not.toHaveProperty('recoveryCodes');
      expect(issuedSql().some((sql) => /is_2fa_enabled = TRUE/.test(sql))).toBe(false);
    });

    it('requires a code', async () => {
      const response = await request(app)
        .post('/api/auth/2fa/verify')
        .set('Authorization', `Bearer ${accessToken()}`)
        .send({});

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('issues a session directly when 2FA is disabled', async () => {
      route([SELECT_LOGIN_USER, () => ({ rows: [userRow()], rowCount: 1 })]);

      const response = await request(app).post('/api/auth/login').send({ walletAddress: 'GADMIN' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('accessToken');
      expect(response.body.requires2fa).toBeUndefined();
    });

    it('withholds the session and returns a challenge when 2FA is enabled', async () => {
      route([
        SELECT_LOGIN_USER,
        () => ({ rows: [userRow({ is_2fa_enabled: true })], rowCount: 1 }),
      ]);

      const response = await request(app).post('/api/auth/login').send({ walletAddress: 'GADMIN' });

      expect(response.status).toBe(200);
      expect(response.body.requires2fa).toBe(true);
      expect(response.body).not.toHaveProperty('accessToken');
      expect(response.body).not.toHaveProperty('refreshToken');

      const claims = jwt.verify(response.body.challengeToken, config.JWT_SECRET) as any;
      expect(claims.typ).toBe(TOKEN_TYPE_2FA_CHALLENGE);
      expect(claims.id).toBe(ADMIN_ID);
      expect(claims.role).toBeUndefined();
    });

    it('requires a wallet address', async () => {
      const response = await request(app).post('/api/auth/login').send({});

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/auth/2fa/authenticate', () => {
    async function challenge() {
      route([
        SELECT_LOGIN_USER,
        () => ({ rows: [userRow({ is_2fa_enabled: true })], rowCount: 1 }),
      ]);
      const login = await request(app).post('/api/auth/login').send({ walletAddress: 'GADMIN' });
      mockQuery.mockReset();
      return login.body.challengeToken as string;
    }

    it('completes login with a valid TOTP code', async () => {
      const { secret, encrypted } = await enrol();
      const challengeToken = await challenge();

      route(
        [
          SELECT_2FA_USER,
          () => ({
            rows: [userRow({ is_2fa_enabled: true, totp_secret: encrypted })],
            rowCount: 1,
          }),
        ],
        [UPDATE_STEP, () => ({ rows: [{ id: ADMIN_ID }], rowCount: 1 })],
        [COUNT_CODES, () => ({ rows: [{ count: 8 }], rowCount: 1 })],
        [SELECT_SESSION_USER, () => ({ rows: [userRow()], rowCount: 1 })]
      );

      const response = await request(app)
        .post('/api/auth/2fa/authenticate')
        .send({ challengeToken, code: authenticator.generate(secret) });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body.usedRecoveryCode).toBe(false);

      const claims = jwt.verify(response.body.accessToken, config.JWT_SECRET) as any;
      expect(claims.typ).toBe(TOKEN_TYPE_ACCESS);
      expect(claims.role).toBe('ADMIN');
    });

    it('completes login with a recovery code and consumes it', async () => {
      const { encrypted } = await enrol();
      const challengeToken = await challenge();

      route(
        [
          SELECT_2FA_USER,
          () => ({
            rows: [userRow({ is_2fa_enabled: true, totp_secret: encrypted })],
            rowCount: 1,
          }),
        ],
        [CONSUME_RECOVERY, () => ({ rows: [{ id: 3 }], rowCount: 1 })],
        [COUNT_CODES, () => ({ rows: [{ count: 7 }], rowCount: 1 })],
        [SELECT_SESSION_USER, () => ({ rows: [userRow()], rowCount: 1 })]
      );

      const response = await request(app)
        .post('/api/auth/2fa/authenticate')
        .send({ challengeToken, code: 'ABCDE-FGHIJ' });

      expect(response.status).toBe(200);
      expect(response.body.usedRecoveryCode).toBe(true);
      expect(response.body.recoveryCodesRemaining).toBe(7);

      const consume = mockQuery.mock.calls.find((call: any[]) =>
        CONSUME_RECOVERY.test(String(call[0]))
      ) as any[];
      expect(consume[1][1]).toBe(hashRecoveryCode('ABCDE-FGHIJ'));
    });

    it('rejects an invalid code without issuing a session', async () => {
      const { encrypted } = await enrol();
      const challengeToken = await challenge();

      route(
        [
          SELECT_2FA_USER,
          () => ({
            rows: [userRow({ is_2fa_enabled: true, totp_secret: encrypted })],
            rowCount: 1,
          }),
        ],
        [UPDATE_STEP, () => ({ rows: [{ id: ADMIN_ID }], rowCount: 1 })]
      );

      const response = await request(app)
        .post('/api/auth/2fa/authenticate')
        .send({ challengeToken, code: '000000' });

      expect(response.status).toBe(401);
      expect(response.body).not.toHaveProperty('accessToken');
    });

    it('rejects an access token presented as a challenge', async () => {
      const response = await request(app)
        .post('/api/auth/2fa/authenticate')
        .send({ challengeToken: accessToken(), code: '123456' });

      expect(response.status).toBe(401);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('rejects an expired challenge', async () => {
      const expired = jwt.sign({ id: ADMIN_ID, typ: TOKEN_TYPE_2FA_CHALLENGE }, config.JWT_SECRET, {
        expiresIn: '-1s',
      });

      const response = await request(app)
        .post('/api/auth/2fa/authenticate')
        .send({ challengeToken: expired, code: '123456' });

      expect(response.status).toBe(401);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('requires both a challenge and a code', async () => {
      const response = await request(app)
        .post('/api/auth/2fa/authenticate')
        .send({ code: '123456' });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/auth/2fa/disable', () => {
    it('disables 2FA with a valid current TOTP code', async () => {
      const { secret, encrypted } = await enrol();

      route(
        [
          SELECT_2FA_USER,
          () => ({
            rows: [userRow({ is_2fa_enabled: true, totp_secret: encrypted })],
            rowCount: 1,
          }),
        ],
        [UPDATE_STEP, () => ({ rows: [{ id: ADMIN_ID }], rowCount: 1 })]
      );

      const response = await request(app)
        .post('/api/auth/2fa/disable')
        .set('Authorization', `Bearer ${accessToken()}`)
        .send({ code: authenticator.generate(secret) });

      expect(response.status).toBe(200);
      expect(response.body.enabled).toBe(false);
      expect(issuedSql().some((sql) => /is_2fa_enabled = FALSE/.test(sql))).toBe(true);
    });

    it('refuses to disable without a valid TOTP code', async () => {
      const { encrypted } = await enrol();

      route(
        [
          SELECT_2FA_USER,
          () => ({
            rows: [userRow({ is_2fa_enabled: true, totp_secret: encrypted })],
            rowCount: 1,
          }),
        ],
        [UPDATE_STEP, () => ({ rows: [{ id: ADMIN_ID }], rowCount: 1 })]
      );

      const response = await request(app)
        .post('/api/auth/2fa/disable')
        .set('Authorization', `Bearer ${accessToken()}`)
        .send({ code: '000000' });

      expect(response.status).toBe(401);
      expect(issuedSql().some((sql) => /is_2fa_enabled = FALSE/.test(sql))).toBe(false);
    });

    it('refuses when 2FA is not enabled', async () => {
      route([SELECT_2FA_USER, () => ({ rows: [userRow()], rowCount: 1 })]);

      const response = await request(app)
        .post('/api/auth/2fa/disable')
        .set('Authorization', `Bearer ${accessToken()}`)
        .send({ code: '123456' });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('NOT_ENABLED');
    });

    it('rejects unauthenticated callers', async () => {
      const response = await request(app).post('/api/auth/2fa/disable').send({ code: '123456' });

      expect(response.status).toBe(401);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe('OAuth callbacks', () => {
    // Passport is mocked to pass straight through, so the callback handler runs
    // with whatever req.user the strategy would have produced.
    const asOAuthUser = (user: Record<string, any>) => {
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        (req as any).user = user;
        next();
      });
      app.use('/api/auth', authRoutes);
      return app;
    };

    it('hands out a session when the account has no 2FA', async () => {
      const response = await request(asOAuthUser(userRow())).get('/api/auth/google/callback');

      expect(response.status).toBe(302);
      const redirect = new URL(response.headers.location);
      expect(redirect.pathname).toBe('/auth-callback');

      const claims = jwt.verify(redirect.searchParams.get('token')!, config.JWT_SECRET) as any;
      expect(claims.typ).toBe(TOKEN_TYPE_ACCESS);
    });

    it('cannot be used to bypass 2FA — issues a challenge instead of a session', async () => {
      const response = await request(asOAuthUser(userRow({ is_2fa_enabled: true }))).get(
        '/api/auth/google/callback'
      );

      expect(response.status).toBe(302);
      const redirect = new URL(response.headers.location);
      expect(redirect.searchParams.get('requires2fa')).toBe('1');
      // No access token anywhere in the redirect.
      expect(redirect.searchParams.get('token')).toBeNull();

      const claims = jwt.verify(
        redirect.searchParams.get('challengeToken')!,
        config.JWT_SECRET
      ) as any;
      expect(claims.typ).toBe(TOKEN_TYPE_2FA_CHALLENGE);
      expect(claims.role).toBeUndefined();
    });

    it('applies the same rule to the GitHub callback', async () => {
      const response = await request(asOAuthUser(userRow({ is_2fa_enabled: true }))).get(
        '/api/auth/github/callback'
      );

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('requires2fa=1');
      expect(response.headers.location).not.toContain('token=ey');
    });
  });

  describe('GET /api/auth/2fa/status', () => {
    it('reports enrolment state without exposing the secret', async () => {
      route(
        [
          SELECT_2FA_USER,
          () => ({
            rows: [
              userRow({
                is_2fa_enabled: true,
                totp_secret: 'v1.super.secret.value',
                two_factor_enabled_at: new Date('2026-01-02T03:04:05Z'),
              }),
            ],
            rowCount: 1,
          }),
        ],
        [COUNT_CODES, () => ({ rows: [{ count: 5 }], rowCount: 1 })]
      );

      const response = await request(app)
        .get('/api/auth/2fa/status')
        .set('Authorization', `Bearer ${accessToken()}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        enabled: true,
        enabledAt: '2026-01-02T03:04:05.000Z',
        setupPending: false,
        recoveryCodesRemaining: 5,
      });
      expect(response.text).not.toContain('super.secret.value');
    });
  });
});
