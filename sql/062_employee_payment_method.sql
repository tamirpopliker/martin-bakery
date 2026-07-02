-- 062_employee_payment_method.sql
-- Some employees are paid by check instead of bank transfer. Adds a
-- payment_method column to the three underlying employee tables so the HR
-- profile can toggle it and the changes-report can surface the switch
-- alongside bank field diffs.

ALTER TABLE branch_employees
  ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'bank_transfer'
    CHECK (payment_method IN ('bank_transfer', 'check'));

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'bank_transfer'
    CHECK (payment_method IN ('bank_transfer', 'check'));

-- hq_employees was added in a later migration; guard so this script is safe
-- even if that table doesn't exist yet.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'hq_employees') THEN
    EXECUTE 'ALTER TABLE hq_employees
      ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT ''bank_transfer''
        CHECK (payment_method IN (''bank_transfer'', ''check''))';
  END IF;
END $$;
