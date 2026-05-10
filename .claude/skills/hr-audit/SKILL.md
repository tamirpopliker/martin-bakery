---
name: hr-audit
description: Audit the HR module — find payslip employees missing from branch_employees / employees, find duplicates, find records with NULL payroll_number / id_number, and report the punch-list the user can clean up via the HR Dashboard or SQL.
---

# hr-audit

Run a battery of SQL queries to validate the HR module's data integrity. The HR Dashboard reads from `hr_employees_unified` (a UNION of `branch_employees` + `employees`). This skill flags every record that's incomplete, duplicate, or missing.

## When to use

- After uploading a new monthly payslip.
- When the user says "X doesn't appear in HR Dashboard" or "the data is messy".
- Periodically — the tables drift quickly because multiple flows insert without HR-complete data (BranchLabor CSV, EmployerCostsUpload).

## Inputs

Optional: a path to a payslip ingestion file (e.g. `sql/data_import_payroll_2026_04.sql`) to verify every payslip row maps to an existing record. If omitted, skip the payslip-anti-join section.

## Queries

### A. Missing data (yellow-warning fodder)

```sql
SELECT 'branch' AS kind, id, name, branch_id, active,
       (payroll_number IS NULL) AS missing_payroll,
       (id_number IS NULL) AS missing_id,
       (start_date IS NULL) AS missing_start_date,
       (bank_account_number IS NULL OR bank_account_number = '') AS missing_bank
FROM branch_employees
WHERE active = true
  AND (payroll_number IS NULL OR id_number IS NULL OR start_date IS NULL OR bank_account_number IS NULL OR bank_account_number = '')
UNION ALL
SELECT 'factory', id, name, NULL, active,
       (employee_number IS NULL OR employee_number = ''),
       (id_number IS NULL),
       (start_date IS NULL),
       (bank_account_number IS NULL OR bank_account_number = '')
FROM employees
WHERE active = true
  AND (employee_number IS NULL OR employee_number = '' OR id_number IS NULL OR start_date IS NULL OR bank_account_number IS NULL OR bank_account_number = '')
ORDER BY 1, 2;
```

### B. Exact-name duplicates

```sql
-- Normalized name (collapse whitespace, then GROUP)
SELECT TRIM(REGEXP_REPLACE(name, '\s+', ' ', 'g')) AS clean_name,
       COUNT(*) AS rows,
       array_agg(id || ' [b' || COALESCE(branch_id::text, 'fac') ||
                 (CASE WHEN active THEN ' ✓' ELSE ' ✗' END) || ']' ORDER BY id) AS records
FROM (
  SELECT id, name, branch_id, active FROM branch_employees
  UNION ALL
  SELECT id, name, NULL::int, active FROM employees
) all_emps
GROUP BY TRIM(REGEXP_REPLACE(name, '\s+', ' ', 'g'))
HAVING COUNT(*) > 1
ORDER BY clean_name;
```

Cross-branch duplicates (same person rostered in two branches with active=true) are typically intentional per project policy ("עובדים שמדי פעם בסניף אחר") — flag them but don't propose deletion.

### C. id_number duplicates

```sql
WITH all_emps AS (
  SELECT 'branch' AS kind, id, name, id_number FROM branch_employees WHERE id_number IS NOT NULL
  UNION ALL
  SELECT 'factory', id, name, id_number FROM employees WHERE id_number IS NOT NULL
)
SELECT id_number, COUNT(*) AS rows,
       array_agg(kind || ':' || id || ' ' || name ORDER BY kind, id) AS records
FROM all_emps
GROUP BY id_number
HAVING COUNT(*) > 1;
```

A single id_number across two records IS a true duplicate — these need merging (see commit 22604eb pattern: redirect FKs from app_users / shift_assignments / schedule_constraints / employee_role_assignments, then DELETE).

### D. Payslip anti-join (if a payslip SQL file is provided)

Reconstruct a `tmp_payslip(payroll_num, id_num, name_he, start_dt, addr, hourly)` temp table from the payslip file's CTE, then:

```sql
SELECT pd.payroll_num, pd.name_he, pd.id_num, pd.start_dt
FROM tmp_payslip pd
WHERE NOT EXISTS (
  SELECT 1 FROM branch_employees b
  WHERE b.payroll_number = pd.payroll_num OR b.id_number = pd.id_num
)
AND NOT EXISTS (
  SELECT 1 FROM employees e
  WHERE (e.employee_number ~ '^\d+$' AND e.employee_number::int = pd.payroll_num)
     OR e.id_number = pd.id_num
)
ORDER BY pd.payroll_num;
```

For each row returned, run a fuzzy name match (forward + reversed two-word + LIKE prefix for Sri Lankan names) before declaring it truly missing — name spelling drifts a lot (e.g. "סדופצי מרסלו" payslip vs "סדופצ'י מרסלו" DB; "קיעאן ראבח" payslip vs "קיעאן רבאח" DB).

### E. Test / placeholder records

```sql
SELECT id, name, branch_id, active
FROM branch_employees
WHERE name IN ('בדיקה', 'test', 'TEST')
   OR name ~ '^\s*$';
```

Don't auto-delete. Some "test" names had real data attached (id=45 was actually `martinmonthly@gmail.com` with 23 schedule_constraints + 7 shifts) — investigate the linked `app_users` / `shift_assignments` first.

## Output

Return a structured punch-list grouped by category (missing data, name dupes, id dupes, missing-from-payslip, suspicious-test). For each item, propose the safest cleanup:

- Missing data → "complete via HR Dashboard wizard" or "auto-link from latest payslip"
- Name duplicate (same branch, both inactive) → safe DELETE of one
- Name duplicate (cross-branch, both active) → flag as cross-branch, leave alone
- id_number duplicate → FK migration + DELETE (template in commit 22604eb / the 443 case)
- Missing from payslip → INSERT via wizard with branch_id=1 default, user reclassifies
- Test record → investigate linked accounts before any action

## Don't

- Don't auto-delete anything with FK references — always do the migration dance first.
- Don't INSERT employees from a payslip without checking via fuzzy match for an existing record with a slightly-different name spelling.
- Don't suggest renaming "ספונוב" → "חודוש" (or similar married/maiden swaps) without explicit user confirmation.
