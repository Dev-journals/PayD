# #095: Full End-to-End Cypress/Playwright Testing Suite

**Category:** [QA]
**Difficulty:** ● MEDIUM
**Tags:** `testing`, `e2e`, `cypress`, `playwright`, `ci`

## Description

Implement a comprehensive End-to-End (E2E) testing suite that simulates a full payroll cycle: from Org Onboarding and Employee Import to Bulk Disbursement and Balance Verification on the Stellar Testnet. This ensures that the complex interplay between the Backend, Frontend, and Blockchain remains stable during development.

## Acceptance Criteria

- [ ] Cypress or Playwright setup in a new `tests/e2e` directory.
- [ ] Automated "Happy Path" test for the full payroll cycle.
- [ ] Mock/Real wallet interaction testing (simulating Albedo/Freighter).
- [ ] Visual regression tests for critical dashboard views.
- [ ] Integration with GitHub Actions to run E2E tests on every PR.
- [ ] Code coverage reporting for the entire stack.
