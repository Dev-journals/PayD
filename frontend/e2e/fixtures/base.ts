import { test as base, expect } from '@playwright/test';
import { setupNetworkMocks } from '../mocks/network';
import { seedAuth } from '../mocks/auth';

/**
 * Base test fixture for PayD E2E tests.
 *
 * Every test built on this fixture automatically:
 *   - has a seeded auth session (no real OAuth login required), and
 *   - has all outbound network traffic mocked (no real Stellar / backend calls).
 *
 * Use `authenticated: false` on a test to opt out of seeded auth (e.g. the
 * login page test), and `mockNetwork: false` to opt out of network mocking.
 *
 *   test('...', async ({ page }) => { ... });                 // both on
 *   test.use({ authenticated: false });                       // per describe/file
 */
export const test = base.extend<{
  authenticated: boolean;
  mockNetwork: boolean;
}>({
  authenticated: [true, { option: true }],
  mockNetwork: [true, { option: true }],

  page: async ({ page, authenticated, mockNetwork }, use) => {
    if (mockNetwork) {
      await setupNetworkMocks(page);
    }
    if (authenticated) {
      await seedAuth(page);
    }
    await use(page);
  },
});

export { expect };
