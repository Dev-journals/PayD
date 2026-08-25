# Frontend E2E tests (Playwright)

End-to-end tests that exercise critical PayD user flows through a real browser.
All outbound network traffic (Stellar Horizon, Soroban RPC, backend API) is
mocked, so tests run offline and never touch the Stellar testnet.

## Running

From the `frontend/` directory:

```bash
# Install browsers once (Chromium + Firefox)
npx playwright install

# Run all E2E tests headlessly
npm run test:e2e

# Interactive UI mode (great for debugging)
npm run test:e2e:ui

# Run with a visible browser
npm run test:e2e:headed

# Open the last HTML report
npm run test:e2e:report
```

The Vite dev server is started automatically by Playwright (`webServer` in
`playwright.config.ts`); you don't need to run `npm run dev` yourself.

## Layout

```
e2e/
├── fixtures/
│   └── base.ts          # Extended `test` — auto-seeds auth + mocks network
├── mocks/
│   ├── auth.ts          # Seeds a fake logged-in session (no real OAuth)
│   ├── horizon.ts       # Canned Horizon / Soroban / API response data
│   └── network.ts       # Route interception + per-test overrides
├── tests/
│   ├── login-navigation.spec.ts   # Login page + sidebar navigation
│   ├── employee.spec.ts           # Employee directory → add → validation
│   ├── payroll.spec.ts            # Payroll form + scheduling wizard → confirm
│   ├── wallet.spec.ts             # Wallet connection entry point
│   └── transactions.spec.ts       # Transaction history display + filtering
└── README.md
```

## Writing tests

Import `test` and `expect` from the base fixture — this gives every test a
seeded auth session and mocked network by default:

```ts
import { test, expect } from '../fixtures/base';

test('does a thing', async ({ page }) => {
  await page.goto('/employee');
  // ...
});
```

Opt out per file/describe when needed:

```ts
test.use({ authenticated: false }); // e.g. the login page
test.use({ mockNetwork: false }); // to hit routes yourself
```

To return custom data for a specific endpoint, use `mockRoute` from
`../mocks/network` after navigating.

## CI

`.github/workflows/e2e.yml` runs these tests on PRs that touch `frontend/**`
and via manual `workflow_dispatch`. The HTML report and failure artifacts
(traces, videos, screenshots) are uploaded as build artifacts.
