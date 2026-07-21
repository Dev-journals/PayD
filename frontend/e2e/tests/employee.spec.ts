import { test, expect } from '../fixtures/base';

/**
 * Critical flow: Employee directory -> Add employee -> Form + validation.
 */

test.describe('Employee management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/employee');
  });

  test('shows the workforce directory with an add action', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /directory/i })).toBeVisible();
    await expect(page.locator('#tour-add-employee')).toBeVisible();
  });

  test('opens the add-employee form', async ({ page }) => {
    await page.locator('#tour-add-employee').click();

    await expect(page.getByRole('heading', { name: /add new employee/i })).toBeVisible();
    await expect(page.locator('#fullName')).toBeVisible();
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#walletAddress')).toBeVisible();
  });

  test('blocks submission when required fields are empty', async ({ page }) => {
    await page.locator('#tour-add-employee').click();

    // Submit with empty required fields -> native HTML5 validation blocks it.
    await page.getByRole('button', { name: 'Add Employee', exact: true }).click();

    // Still on the form (submission did not go through).
    await expect(page.getByRole('heading', { name: /add new employee/i })).toBeVisible();

    // The Full Name field reports itself as invalid.
    const fullNameInvalid = await page
      .locator('#fullName')
      .evaluate((el: HTMLInputElement) => !el.checkValidity());
    expect(fullNameInvalid).toBe(true);
  });

  test('accepts a valid employee entry', async ({ page }) => {
    await page.locator('#tour-add-employee').click();

    await page.locator('#fullName').fill('Ada Lovelace');
    await page.locator('#email').fill('ada@payd.test');

    // Fields hold their values and pass native validation.
    await expect(page.locator('#fullName')).toHaveValue('Ada Lovelace');
    await expect(page.locator('#email')).toHaveValue('ada@payd.test');

    const emailValid = await page
      .locator('#email')
      .evaluate((el: HTMLInputElement) => el.checkValidity());
    expect(emailValid).toBe(true);
  });
});
