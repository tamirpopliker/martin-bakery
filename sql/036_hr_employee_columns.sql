-- 036_hr_employee_columns.sql
-- HR module: extend branch_employees and employees with HR fields
-- + trigger that sets active=false automatically when end_date is filled in.

ALTER TABLE branch_employees
  ADD COLUMN IF NOT EXISTS id_number              TEXT,
  ADD COLUMN IF NOT EXISTS birth_date             DATE,
  ADD COLUMN IF NOT EXISTS address                TEXT,
  ADD COLUMN IF NOT EXISTS bank_name              TEXT,
  ADD COLUMN IF NOT EXISTS bank_branch            TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_number    TEXT,
  ADD COLUMN IF NOT EXISTS position               TEXT,
  ADD COLUMN IF NOT EXISTS start_date             DATE,
  ADD COLUMN IF NOT EXISTS end_date               DATE,
  ADD COLUMN IF NOT EXISTS monthly_salary         NUMERIC,
  ADD COLUMN IF NOT EXISTS notes                  TEXT,
  ADD COLUMN IF NOT EXISTS photo_url              TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS retention_bonus        NUMERIC,
  ADD COLUMN IF NOT EXISTS email                  TEXT,
  ADD COLUMN IF NOT EXISTS phone                  TEXT,
  ADD COLUMN IF NOT EXISTS id_number              TEXT,
  ADD COLUMN IF NOT EXISTS birth_date             DATE,
  ADD COLUMN IF NOT EXISTS address                TEXT,
  ADD COLUMN IF NOT EXISTS bank_name              TEXT,
  ADD COLUMN IF NOT EXISTS bank_branch            TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_number    TEXT,
  ADD COLUMN IF NOT EXISTS position               TEXT,
  ADD COLUMN IF NOT EXISTS start_date             DATE,
  ADD COLUMN IF NOT EXISTS end_date               DATE,
  ADD COLUMN IF NOT EXISTS monthly_salary         NUMERIC,
  ADD COLUMN IF NOT EXISTS notes                  TEXT,
  ADD COLUMN IF NOT EXISTS photo_url              TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT;

CREATE OR REPLACE FUNCTION hr_sync_active_with_end_date() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.end_date IS NOT NULL
     AND (OLD.end_date IS NULL OR NEW.end_date IS DISTINCT FROM OLD.end_date) THEN
    NEW.active := false;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS branch_employees_end_date_active ON branch_employees;
CREATE TRIGGER branch_employees_end_date_active
  BEFORE UPDATE ON branch_employees
  FOR EACH ROW EXECUTE FUNCTION hr_sync_active_with_end_date();

DROP TRIGGER IF EXISTS employees_end_date_active ON employees;
CREATE TRIGGER employees_end_date_active
  BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION hr_sync_active_with_end_date();
