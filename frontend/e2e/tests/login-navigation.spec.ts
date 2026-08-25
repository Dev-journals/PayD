import { test, expect } from '../fixtures/base';

/**
 * Critical flow: Login page renders, and an authenticated user can navigate
 * the dashboard via the sidebar.
 */

test.describe('Login page', () => {
  // The login page is the one place we do NOT want a seeded session.
  test.use({ authenticated: false });

  test('renders OAuth login options', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /continue with github/i })).toBeVisible();
  });
});

test.describe('Dashboard navigation', () => {
  test('lands on the home dashboard', async ({ page }) => {
    await page.goto('/');

    // Home hero heading is composed from i18n fragments -> "Automate your Payroll ...".
    await expect(page.getByRole('heading', { name: /automate your/i })).toBeVisible();
  });

  test('navigates between sections via the sidebar', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('link', { name: 'Employees' }).click();
    await expect(page).toHaveURL(/\/employee$/);

    await page.getByRole('link', { name: 'Payroll', exact: true }).click();
    await expect(page).toHaveURL(/\/payroll$/);

    await page.getByRole('link', { name: 'History' }).click();
    await expect(page).toHaveURL(/\/transactions$/);
  });

  test('home CTA routes to payroll', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: /manage payroll/i }).click();
    await expect(page).toHaveURL(/\/payroll$/);
  });
});
