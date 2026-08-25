# #091: Payroll Forecasting & Liquidity Management

**Category:** [BACKEND/FRONTEND]
**Difficulty:** ● MEDIUM
**Tags:** `forecasting`, `liquidity`, `analytics`, `charts`

## Description

Implement a forecasting tool that helps Organizations visualize their upcoming payroll liabilities (including taxes and benefits) several months in advance. This helps them ensure they have enough liquidity (Stablecoins/XLM) in their distribution account before the scheduled payroll run.

## Acceptance Criteria

- [ ] Forecasting engine that extrapolates current payroll data 3-6 months forward.
- [ ] Integration with historical FX trends to estimate currency risk.
- [ ] "Liquidity Status" UI indicator (Green/Yellow/Red) based on current account balance vs next 2 payroll runs.
- [ ] Automated email/push alerts when liquidity is insufficient for an upcoming run.
- [ ] Visual charts (Recharts/Chart.js) showing projected vs actual payroll costs.
