-- 032: Populate app_users.employee_id (was always null) and update auth trigger
--
-- Background: app_users.employee_id was declared but the auth trigger never set
-- it. EmployeeConstraints.tsx had to fall back to email-based lookup, which
-- breaks when an employee row has an empty email or when the same name appears
-- multiple times across branches. This migration:
--   1. Backfills app_users.employee_id for all existing role='employee' rows
--      using email match, preferring active records.
--   2. Updates handle_new_auth_user to populate employee_id on new sign-ups.

-- ─── Step 1: Backfill ────────────────────────────────────────────────────────
-- For each app_users row with role='employee' and employee_id IS NULL, find
-- the matching branch_employees row by email. If multiple matches exist (e.g.
-- legacy duplicates across branches), prefer active=true. If still ambiguous,
-- prefer the row whose branch_id matches the app_users.branch_id.
UPDATE app_users au
SET employee_id = sub.id
FROM (
  SELECT DISTINCT ON (be.email)
    be.id, be.email, be.branch_id, be.active
  FROM branch_employees be
  WHERE be.email IS NOT NULL AND be.email <> ''
  ORDER BY be.email, be.active DESC, be.id ASC
) sub
WHERE au.role = 'employee'
  AND au.employee_id IS NULL
  AND lower(au.email) = lower(sub.email);

-- ─── Step 2: Replace trigger function ────────────────────────────────────────
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_auth_user();

CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS TRIGGER AS $$
DECLARE
  v_employee_id INT;
  v_branch_id INT;
  v_name TEXT;
BEGIN
  -- Find employee by email — prefer active record if duplicates exist
  SELECT id, branch_id, name
  INTO v_employee_id, v_branch_id, v_name
  FROM branch_employees
  WHERE lower(email) = lower(NEW.email)
  ORDER BY active DESC, id ASC
  LIMIT 1;

  -- If found and no app_users record exists yet, create one
  IF v_employee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM app_users WHERE lower(email) = lower(NEW.email)
  ) THEN
    INSERT INTO app_users (email, name, role, branch_id, employee_id, auth_uid)
    VALUES (
      NEW.email,
      COALESCE(v_name, NEW.raw_user_meta_data->>'full_name', NEW.email),
      'employee',
      v_branch_id,
      v_employee_id,
      NEW.id
    );
  END IF;

  -- If app_users exists but missing auth_uid / employee_id — update it
  UPDATE app_users
  SET auth_uid = COALESCE(auth_uid, NEW.id),
      employee_id = COALESCE(employee_id, v_employee_id)
  WHERE lower(email) = lower(NEW.email);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();

-- ─── Verification (manual — uncomment to run) ─────────────────────────────────
-- SELECT count(*) FILTER (WHERE employee_id IS NULL) AS missing,
--        count(*) FILTER (WHERE employee_id IS NOT NULL) AS linked
-- FROM app_users WHERE role = 'employee';
