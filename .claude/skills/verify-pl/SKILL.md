---
name: verify-pl
description: Cross-check revenue / labor / waste / operating-profit numbers across Home, CEODashboard, and BranchManagerDashboard for a given month. Flags the kinds of bugs we've hit before (Hakafa double-count, factory.internalRevenue not eliminated, branch_pl_summary view diverging from calculateBranchPL, missing factoryManagerSalary in labor).
---

# verify-pl

Run SQL diagnostics against Supabase to verify that the three dashboards (Home, CEODashboard, BranchManagerDashboard) all report the same numbers for the same month. Output a punch-list of discrepancies the user should investigate.

## When to use

- After any change to `src/lib/calculatePL.ts`, `src/lib/profitCalc.ts`, `src/pages/Home.tsx`, `src/pages/CEODashboard.tsx`, or `src/pages/BranchManagerDashboard.tsx`.
- When the user reports "the numbers don't match between dashboards" or "the values look wrong".
- Before merging a P&L-related PR.

## Inputs

Ask the user for the month to verify in `YYYY-MM` form (e.g. `2026-04`). Default to the current month if not given.

## What to check

The queries below assume month = `2026-04` — substitute with the user's month. The SQL editor is at supabase.com → SQL Editor.

### 1. Revenue identity

The "real revenue" KPI on every dashboard must equal:
`sum(branch_revenue.amount where source != 'credit_b2b') + sum(register_closings.cash_sales + register_closings.credit_sales) + factory_external_sales - intercompany_eliminated`

```sql
-- 1a. Branch revenue total (legacy table)
SELECT COALESCE(SUM(amount), 0) AS branch_revenue_legacy
FROM branch_revenue
WHERE date >= '2026-04-01' AND date < '2026-05-01';

-- 1b. Register closings total (cash + credit-card)
SELECT COALESCE(SUM(cash_sales + credit_sales), 0) AS register_closings_total
FROM register_closings
WHERE date >= '2026-04-01' AND date < '2026-05-01';

-- 1c. B2B invoices (Hakafa)
SELECT
  COALESCE(SUM(CASE WHEN branch_id IS NOT NULL THEN total_before_vat END), 0) AS branch_b2b,
  COALESCE(SUM(CASE WHEN branch_id IS NULL THEN total_before_vat END), 0) AS factory_b2b
FROM b2b_invoices
WHERE invoice_date >= '2026-04-01' AND invoice_date < '2026-05-01';

-- 1d. Factory external + internal sales
SELECT
  COALESCE(SUM(total_amount) FILTER (WHERE status = 'completed'), 0) AS factory_internal,
  (SELECT COALESCE(SUM(total_before_vat), 0) FROM external_sales
   WHERE invoice_date >= '2026-04-01' AND invoice_date < '2026-05-01') AS factory_external
FROM internal_sales
WHERE order_date >= '2026-04-01' AND order_date < '2026-05-01';
```

Add the rows: `consolidated_revenue = 1a + 1b + 1c.branch_b2b + 1c.factory_b2b + 1d.factory_external` (NOT factory_internal — that's intercompany, eliminates against branch.factoryPurchases).

Compare with what each dashboard shows on screen. Discrepancies > ₪1 mean a bug.

### 2. Hakafa identity (the bug we fixed in commit 55b601d)

`register_closings.credit_sales` is **credit-card POS revenue, NOT customer credit / Hakafa**. It must NOT appear in the Hakafa bucket.

```sql
-- Expected Hakafa breakdown — must equal what CEODashboard's "הכנסות הקפה" panel shows
SELECT
  COALESCE(SUM(amount) FILTER (WHERE source IN ('credit', 'credit_b2b') AND branch_id = 1), 0) AS avraham_avinu,
  COALESCE(SUM(amount) FILTER (WHERE source IN ('credit', 'credit_b2b') AND branch_id = 2), 0) AS hapoalim,
  COALESCE(SUM(amount) FILTER (WHERE source IN ('credit', 'credit_b2b') AND branch_id = 3), 0) AS yaakov_kohen
FROM branch_revenue
WHERE date >= '2026-04-01' AND date < '2026-05-01';

-- Plus B2B invoices per branch (also Hakafa)
SELECT branch_id, COALESCE(SUM(total_before_vat), 0) AS b2b
FROM b2b_invoices
WHERE invoice_date >= '2026-04-01' AND invoice_date < '2026-05-01'
GROUP BY branch_id;
```

If any branch's Hakafa on the dashboard exceeds these sums, `register_closings.credit_sales` is being double-counted somewhere.

### 3. Labor identity

Total labor on Home must equal:
`factory.labor (employer_costs is_headquarters=false, is_manager=false) + factory.managerSalary (is_manager=true) + sum(branches.labor) + sum(branches.managerSalary) + total HQ payroll (is_headquarters=true)`

```sql
-- Total payroll components for the month
SELECT
  COALESCE(SUM(actual_employer_cost) FILTER (WHERE branch_id IS NULL AND is_headquarters = false AND is_manager = false), 0) AS factory_labor,
  COALESCE(SUM(actual_employer_cost) FILTER (WHERE branch_id IS NULL AND is_headquarters = false AND is_manager = true), 0)  AS factory_managers,
  COALESCE(SUM(actual_employer_cost) FILTER (WHERE branch_id IS NOT NULL AND is_manager = false), 0)                          AS branch_labor,
  COALESCE(SUM(actual_employer_cost) FILTER (WHERE branch_id IS NOT NULL AND is_manager = true), 0)                           AS branch_managers,
  COALESCE(SUM(actual_employer_cost) FILTER (WHERE is_headquarters = true), 0)                                                AS hq_payroll
FROM employer_costs
WHERE year = 2026 AND month = 4;
```

Sum of these 5 columns must match Home's "לייבור" KPI exactly. Any miss usually traces to a forgotten `+ factory.managerSalary` or a missing `is_headquarters=true` join.

### 4. Operating-profit identity

True consolidated OP = revenue (#1) − suppliers − all labor (#3) − waste − repairs − fixedCosts − branch deliveries/infra/other.

The Home card is supposed to match this exactly. CEODashboard's OP differs intentionally (it adds back waste because the consolidated table has no waste row — see comment at CEODashboard.tsx:937 "waste excluded by user request"). If the two diverge by exactly `sum(branches.waste)`, that's the design, not a bug.

## Output format

Return a punch-list:

```
period: 2026-04

revenue
  expected: ₪X,XXX,XXX  (sum of 1a+1b+1c+1d.factory_external)
  Home:     ₪X
  CEO:      ₪X
  BranchMgr (per branch): ...
  ✓ match  /  ✗ off by ₪Y

hakafa
  branch_revenue['credit'+'credit_b2b'] + b2b_invoices = ₪X
  CEO panel total = ₪X
  ✓ match  /  ✗ ...

labor
  expected: ₪X
  Home:     ₪X
  CEO:      ₪X
  ✓ / ✗

operating profit
  Home (true OP):     ₪X
  CEO ("OP w/o waste"): expected_diff = sum(branch.waste)
  ✓ / ✗
```

## Don't

- Don't query data without a date range — these tables are large.
- Don't trust `branch_pl_summary` view; use `calculateBranchPL` math (we hit a ₪300k divergence in commit `803dce9`).
- Don't suggest fixes inside this skill — your job is to detect and report, not to edit code.
