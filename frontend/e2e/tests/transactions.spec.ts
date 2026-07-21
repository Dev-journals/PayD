import { test, expect } from '../fixtures/base';

/**
 * Critical flow: Transaction history display and filtering.
 */

test.describe('Transaction history', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/transactions');
  });

  test('renders the transaction history view', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /transaction history/i })).toBeVisible();
    // Filters (including the search box) are collapsed behind a toggle.
    await page.getByRole('button', { name: /filters/i }).click();
    await expect(page.getByPlaceholder(/search tx hash/i)).toBeVisible();
  });

  test('exposes status filter options', async ({ page }) => {
    await page.getByRole('button', { name: /filters/i }).click();

    const statusFilter = page.locator('select', {
      has: page.locator('option', { hasText: 'Confirmed' }),
    });
    await expect(statusFilter).toBeVisible();

    await statusFilter.selectOption('confirmed');
    await expect(statusFilter).toHaveValue('confirmed');
  });

  test('accepts a search query', async ({ page }) => {
    await page.getByRole('button', { name: /filters/i }).click();

    const search = page.getByPlaceholder(/search tx hash/i);
    await search.fill('abc123');
    await expect(search).toHaveValue('abc123');
  });
});
