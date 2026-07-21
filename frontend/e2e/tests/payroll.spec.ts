import { test, expect } from '../fixtures/base';

/**
 * Critical flow: Payroll scheduler -> Create schedule (wizard) -> Confirm.
 */

test.describe('Payroll scheduler', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/payroll');
  });

  test('renders the payroll setup form', async ({ page }) => {
    await expect(page.locator('#employeeName')).toBeVisible();
    await expect(page.locator('#amount')).toBeVisible();
    await expect(page.locator('#frequency')).toBeVisible();
  });

  test('fills the inline payroll form', async ({ page }) => {
    await page.locator('#employeeName').fill('Satoshi Nakamoto');
    await page.locator('#amount').fill('1500');
    await page.locator('#frequency').selectOption('monthly');

    await expect(page.locator('#employeeName')).toHaveValue('Satoshi Nakamoto');
    await expect(page.locator('#amount')).toHaveValue('1500');
    await expect(page.locator('#frequency')).toHaveValue('monthly');
  });

  test('walks the scheduling wizard through to the confirm step', async ({ page }) => {
    await page.getByRole('button', { name: /open scheduling wizard/i }).click();

    // Step 1
    await expect(page.getByRole('heading', { name: /set schedule/i })).toBeVisible();
    await page.getByRole('button', { name: /continue/i }).click();

    // Step 2
    await expect(page.getByRole('heading', { name: /currency preferences/i })).toBeVisible();
    await page.getByRole('button', { name: /continue/i }).click();

    // Step 3: Preview & Confirm
    await expect(page.getByRole('heading', { name: /preview & confirm/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /confirm schedule/i })).toBeVisible();
  });
});
