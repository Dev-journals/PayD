import type { Page } from '@playwright/test';

/** A syntactically-valid but non-sensitive fake JWT for seeding auth state. */
const FAKE_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiJlMmUtdGVzdC11c2VyIiwiZW1haWwiOiJlMmVAcGF5ZC50ZXN0IiwiaWF0IjoxNzAwMDAwMDAwfQ.' +
  'e2e_signature_not_verified';

/**
 * Seed a logged-in session so tests skip the real OAuth flow. Runs before any
 * page script via `addInitScript`, so the tokens are present on every
 * navigation within the test.
 *
 * The app reads several token keys across services (`payd_auth_token` and
 * `accessToken`), so we set both.
 */
export async function seedAuth(page: Page): Promise<void> {
  await page.addInitScript((token: string) => {
    try {
      window.localStorage.setItem('payd_auth_token', token);
      window.localStorage.setItem('accessToken', token);
      window.localStorage.setItem(
        'payd_user',
        JSON.stringify({ id: 'e2e-test-user', email: 'e2e@payd.test', name: 'E2E Tester' })
      );
    } catch {
      // localStorage may be unavailable in some contexts; ignore.
    }
  }, FAKE_JWT);
}
