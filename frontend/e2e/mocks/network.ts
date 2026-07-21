import type { Page, Route, Request } from '@playwright/test';
import {
  horizonAccount,
  horizonPayments,
  horizonTransactions,
  sorobanRpcResponse,
  emptyApiList,
  schedulesResponse,
  payrollRunsResponse,
  auditResponse,
} from './horizon';

const JSON_HEADERS = { 'content-type': 'application/json' };

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

/**
 * Intercept all outbound network traffic so E2E tests never touch the real
 * Stellar network or a backend. Anything not explicitly matched below is
 * fulfilled with an empty-but-valid JSON payload so the app degrades quietly
 * instead of hanging on a real request.
 *
 * Routes are registered most-specific-first because Playwright evaluates the
 * most recently registered handler first.
 */
export async function setupNetworkMocks(page: Page): Promise<void> {
  // Friendbot (testnet funding).
  await page.route(/friendbot/i, (route) => json(route, { successful: true }));

  // Soroban RPC (JSON-RPC POST endpoints).
  await page.route(/soroban|\/rpc(\b|\/)/i, async (route: Route, request: Request) => {
    let id: number | string = 1;
    try {
      const payload = request.postDataJSON?.() as { id?: number | string } | undefined;
      if (payload?.id !== undefined) id = payload.id;
    } catch {
      // non-JSON body, keep default id
    }
    return json(route, sorobanRpcResponse(id));
  });

  // Stellar Horizon REST endpoints.
  await page.route(/horizon/i, (route: Route, request: Request) => {
    const url = request.url();
    if (/\/accounts\//.test(url)) return json(route, horizonAccount);
    if (/\/payments\b/.test(url)) return json(route, horizonPayments);
    if (/\/transactions\b/.test(url)) return json(route, horizonTransactions);
    return json(route, { _embedded: { records: [] } });
  });

  // Backend API (dev defaults: localhost:3000 / :3001 and any /api path).
  await page.route(/localhost:300[01]|\/api\//i, (route: Route, request: Request) => {
    const url = request.url();
    if (/\/auth\/(me|session|profile)/.test(url)) {
      return json(route, { id: 'test-user', email: 'e2e@payd.test', name: 'E2E Tester' });
    }
    return json(route, emptyApiList);
  });

  // Endpoint-specific shapes (registered last so they take precedence over the
  // generic API handler above — Playwright evaluates the most recent match first).
  await page.route(/\/payroll-bonus\/runs\b/i, (route) => json(route, payrollRunsResponse));
  await page.route(/\/schedules\b/i, (route) => json(route, schedulesResponse));
  await page.route(/\/audit\b/i, (route) => json(route, auditResponse));
}

/**
 * Override a single route with a custom response. Useful for testing specific
 * states (e.g. a failed transaction, a populated transaction list). Registered
 * after {@link setupNetworkMocks}, so it takes precedence for matching URLs.
 */
export async function mockRoute(
  page: Page,
  urlPattern: string | RegExp,
  body: unknown,
  status = 200
): Promise<void> {
  await page.route(urlPattern, (route) => json(route, body, status));
}
