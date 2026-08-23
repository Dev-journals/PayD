/**
 * Unit tests for the 2FA step-up middleware guarding sensitive payment routes.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
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

const { require2FA } = await import('../require2fa.js');
const { startSetup } = await import('../../services/twoFactorService.js');

const USER_ID = 42;

type QueryResult = { rows: any[]; rowCount?: number };
type Route = [RegExp, (params: any[]) => QueryResult];

const SELECT_FLAG = /SELECT is_2fa_enabled FROM users/;
const SELECT_2FA_USER = /SELECT id, wallet_address, email, role/;
const UPDATE_STEP = /SET totp_last_used_step = \$2/;

function route(...routes: Route[]) {
  mockQuery.mockImplementation(async (sql: string, params: any[] = []) => {
    for (const [pattern, handler] of routes) {
      if (pattern.test(sql)) return handler(params);
    }
    return { rows: [], rowCount: 0 };
  });
}

function buildRes() {
  const res = {
    statusCode: 0,
    body: undefined as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: any };
}

function buildReq(overrides: Partial<Request> = {}): Request {
  return { headers: {}, body: {}, user: { id: USER_ID }, ...overrides } as unknown as Request;
}

/**
 * Produces a secret plus the ciphertext the service would have stored.
 *
 * QR generation is slow, so the pair is produced once and shared: the tests
 * only need *a* valid secret, not a distinct one each time.
 */
let enrolment: Promise<{ secret: string; encrypted: string }> | null = null;

async function enrol(): Promise<{ secret: string; encrypted: string }> {
  if (enrolment) {
    const cached = await enrolment;
    mockQuery.mockReset();
    return cached;
  }

  route([
    SELECT_2FA_USER,
    () => ({
      rows: [
        {
          id: USER_ID,
          wallet_address: 'GADMIN',
          email: null,
          role: 'ADMIN',
          is_2fa_enabled: false,
          totp_secret: null,
          totp_pending_secret: null,
          two_factor_enabled_at: null,
          two_factor_locked_until: null,
          is_locked: false,
        },
      ],
      rowCount: 1,
    }),
  ]);

  const { secret } = await startSetup(USER_ID);
  const update = mockQuery.mock.calls.find((call: any[]) =>
    /totp_pending_secret = \$2/.test(String(call[0]))
  ) as any[];

  mockQuery.mockReset();
  const result = { secret, encrypted: update[1][1] as string };
  enrolment = Promise.resolve(result);
  return result;
}

function enabledUserRow(encrypted: string) {
  return {
    id: USER_ID,
    wallet_address: 'GADMIN',
    email: null,
    role: 'ADMIN',
    is_2fa_enabled: true,
    totp_secret: encrypted,
    totp_pending_secret: null,
    two_factor_enabled_at: new Date(),
    two_factor_locked_until: null,
    is_locked: false,
  };
}

describe('require2FA', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('rejects requests that have not been authenticated', async () => {
    const res = buildRes();
    const next = jest.fn() as unknown as NextFunction;

    await require2FA(buildReq({ user: undefined } as any), res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('lets accounts without 2FA through', async () => {
    route([SELECT_FLAG, () => ({ rows: [{ is_2fa_enabled: false }], rowCount: 1 })]);
    const next = jest.fn() as unknown as NextFunction;

    await require2FA(buildReq(), buildRes(), next);

    expect(next).toHaveBeenCalled();
  });

  it('blocks a 2FA account that supplies no code', async () => {
    route([SELECT_FLAG, () => ({ rows: [{ is_2fa_enabled: true }], rowCount: 1 })]);
    const res = buildRes();
    const next = jest.fn() as unknown as NextFunction;

    await require2FA(buildReq(), res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('TWO_FACTOR_REQUIRED');
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts a valid code from the x-2fa-token header', async () => {
    const { secret, encrypted } = await enrol();
    route(
      [SELECT_FLAG, () => ({ rows: [{ is_2fa_enabled: true }], rowCount: 1 })],
      [SELECT_2FA_USER, () => ({ rows: [enabledUserRow(encrypted)], rowCount: 1 })],
      [UPDATE_STEP, () => ({ rows: [{ id: USER_ID }], rowCount: 1 })]
    );
    const next = jest.fn() as unknown as NextFunction;

    await require2FA(
      buildReq({ headers: { 'x-2fa-token': authenticator.generate(secret) } } as any),
      buildRes(),
      next
    );

    expect(next).toHaveBeenCalled();
  });

  it('rejects a code that was already spent, so a header cannot be replayed', async () => {
    const { secret, encrypted } = await enrol();
    route(
      [SELECT_FLAG, () => ({ rows: [{ is_2fa_enabled: true }], rowCount: 1 })],
      [SELECT_2FA_USER, () => ({ rows: [enabledUserRow(encrypted)], rowCount: 1 })],
      // The guarded UPDATE matches nothing once the step has been burned.
      [UPDATE_STEP, () => ({ rows: [], rowCount: 0 })]
    );
    const res = buildRes();
    const next = jest.fn() as unknown as NextFunction;

    await require2FA(
      buildReq({ headers: { 'x-2fa-token': authenticator.generate(secret) } } as any),
      res,
      next
    );

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('ignores a wallet address supplied by the client', async () => {
    route([SELECT_FLAG, () => ({ rows: [{ is_2fa_enabled: false }], rowCount: 1 })]);
    const next = jest.fn() as unknown as NextFunction;

    await require2FA(
      buildReq({ body: { walletAddress: 'GSOMEONE_ELSE' }, headers: {} } as any),
      buildRes(),
      next
    );

    expect(next).toHaveBeenCalled();
    expect(mockQuery.mock.calls[0][1]).toEqual([USER_ID]);
  });
});
