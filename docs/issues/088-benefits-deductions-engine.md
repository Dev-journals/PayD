# #088: Benefits & Automatic Deductions Engine

**Category:** [BACKEND]
**Difficulty:** ● MEDIUM
**Tags:** `payroll`, `deductions`, `benefits`, `calculations`

## Description

Build a flexible engine to handle non-salary payroll components like healthcare premiums, retirement contributions (401k/Pension), and taxes. The engine should calculate these deductions before submitting the final net pay to the Stellar network.

## Acceptance Criteria

- [ ] CRUD API for "Benefit Plans" and "Deduction Rules".
- [ ] Pre-payroll calculation service that generates a "Draft Payslip" showing Gross vs Net.
- [ ] Support for percentage-based and fixed-amount deductions.
- [ ] Logic to route deducted funds to specific "Company Treasury" or "Insurance Provider" wallets.
- [ ] Employee view in the portal to see a breakdown of their deductions.
