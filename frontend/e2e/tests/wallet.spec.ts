import { test, expect } from '../fixtures/base';

/**
 * Critical flow: Wallet connection entry point.
 *
 * We can't drive a real browser-extension wallet in CI, so this validates that
 * the connect action is reachable from the dashboard top bar and opens the
 * Stellar Wallets Kit selection modal.
 */

test.describe('Wallet connection', () => {
  // The connect button only shows when there is no active session, so run these
  // without a seeded auth token.
  test.use({ authenticated: false });

  test('exposes the connect action on the dashboard', async ({ page }) => {
    await page.goto('/');

    const connect = page.locator('#tour-connect');
    await expect(connect).toBeVisible();
    await expect(connect).toContainText(/connect/i);
    await expect(connect).toBeEnabled();
  });

  test('opens the wallet selection modal', async ({ page }) => {
    await page.goto('/');

    await page.locator('#tour-connect').click();

    // The Stellar Wallets Kit mounts its selection UI as a custom element whose
    // visible content lives in shadow DOM (the host itself has no layout box).
    // Assert the modal opened via its `showmodal` attribute, and that the title
    // it renders is visible (Playwright pierces the open shadow root for text).
    await expect(page.locator('stellar-wallets-modal[showmodal]')).toBeAttached();
    await expect(page.getByText(/connect to payd/i)).toBeVisible();
  });
});
