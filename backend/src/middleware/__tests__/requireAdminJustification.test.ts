/**
 * Unit tests for requireAdminJustification middleware (Part 49)
 * These tests mock the database pool so no live DB is required.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { requireAdminJustification } from '../requireAdminJustification.js';
import type { Request, Response, NextFunction } from 'express';

// Mock the database pool so INSERT never runs in unit tests
jest.mock('../../config/database.js', () => ({
  pool: { query: jest.fn().mockResolvedValue({ rows: [] }) },
}));

function buildReq(overrides: Partial<Request> = {}): Partial<Request> {
  return {
    headers: { 'user-agent': 'jest-test' } as any,
    params: { orgId: '10' },
    path: '/api/admin/tenants/10/employees',
    method: 'GET',
    ip: '127.0.0.1',
    user: { id: 'admin-99', email: 'platform@payd.io', role: 'PLATFORM_ADMIN' } as any,
    tenantId: undefined,
    ...overrides,
  };
}

function buildRes(): { status: jest.Mock; json: jest.Mock; on: jest.Mock; statusCode: number } {
  return {
    statusCode: 200,
    status: jest.fn().mockReturnThis() as jest.Mock,
    json:   jest.fn().mockReturnThis() as jest.Mock,
    on:     jest.fn() as jest.Mock,
  };
}

describe('requireAdminJustification', () => {
  let next: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    next = jest.fn() as jest.MockedFunction<NextFunction>;
  });

  it('rejects with 403 when no x-admin-reason header is present', async () => {
    const req = buildReq();
    const res = buildRes();

    await requireAdminJustification(req as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects with 403 when justification is only whitespace', async () => {
    const req = buildReq({ headers: { 'x-admin-reason': '   ' } as any });
    const res = buildRes();

    await requireAdminJustification(req as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rejects when justification is fewer than 10 characters', async () => {
    const req = buildReq({ headers: { 'x-admin-reason': 'short' } as any });
    const res = buildRes();

    await requireAdminJustification(req as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(403);
    const body = (res.json as jest.Mock).mock.calls[0][0] as any;
    expect(body.error).toBe('Admin justification required');
  });

  it('calls next() when a sufficient justification is supplied', async () => {
    const req = buildReq({
      headers: { 'x-admin-reason': 'Investigating support ticket PAYD-9001' } as any,
    });
    const res = buildRes();

    await requireAdminJustification(req as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('registers an on-finish handler to log the access after response', async () => {
    const req = buildReq({
      headers: { 'x-admin-reason': 'Investigating support ticket PAYD-9002' } as any,
    });
    const res = buildRes();

    await requireAdminJustification(req as Request, res as unknown as Response, next);

    // The on('finish') listener must be registered so the log fires after the response
    expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
  });
});
