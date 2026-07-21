import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for PayD frontend E2E tests.
 *
 * Tests run against the Vite dev server (started automatically via `webServer`)
 * and mock all outbound network traffic (Stellar Horizon, Soroban RPC, backend
 * API) so no real network calls or testnet transactions are required.
 *
 * See ./e2e/README.md for details.
 */

const PORT = Number(process.env.E2E_PORT ?? 5173);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // Run tests within each file in parallel.
  fullyParallel: true,
  // Fail the build on CI if test.only was left in the source.
  forbidOnly: !!process.env.CI,
  // Retry flaky tests on CI only.
  retries: process.env.CI ? 2 : 0,
  // Limit workers on CI for stability.
  workers: process.env.CI ? 2 : undefined,
  // HTML report for humans, plus a compact line reporter for the terminal/CI logs.
  reporter: [['html', { open: 'never' }], ['list']],
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  // Desktop browsers only for the initial setup (mobile is out of scope).
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],

  // Start the Vite dev server before running tests.
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
