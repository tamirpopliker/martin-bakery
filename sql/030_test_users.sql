-- Migration 030: test users for RLS automated testing
--
-- Two-step setup (order doesn't matter — script handles both):
--   A) Run this SQL in Supabase SQL Editor.
--   B) In Supabase Dashboard → Authentication → Users → Add user, create:
--        test-admin@martin.local    + strong password
--        test-factory@martin.local  + strong password
--        test-branch@martin.local   + strong password
--
-- Mechanics:
--   - The INSERT below adds app_users rows without auth_uid.
--   - When you create the Auth user, the on_auth_user_created trigger updates
--     the matching app_users row by email and fills in auth_uid.
--   - If you create the Auth user BEFORE running this SQL, the trigger fires
--     but finds nothing to update; the final UPDATE in this script then patches
--     auth_uid by looking it up in auth.users.
-- Result: idempotent — safe to re-run.

BEGIN;

INSERT INTO app_users (email, name, role, branch_id, excluded_departments, can_settings) VALUES
  ('test-admin@martin.local',   'Test Admin',   'admin',   NULL, '{}', FALSE),
  ('test-factory@martin.local', 'Test Factory', 'factory', NULL, '{}', FALSE),
  ('test-branch@martin.local',  'Test Branch',  'branch',  1,    '{}', FALSE)
ON CONFLICT (email) DO UPDATE SET
  name = EXCLUDED.name,
  role = EXCLUDED.role,
  branch_id = EXCLUDED.branch_id;

-- Backfill auth_uid for any test user already in auth.users (handles "Auth user
-- created before SQL ran" case).
UPDATE app_users a
SET auth_uid = u.id
FROM auth.users u
WHERE a.email = u.email
  AND a.email LIKE 'test-%@martin.local'
  AND a.auth_uid IS NULL;

COMMIT;

-- ============================================================
-- AFTER creating Auth users, verify auth_uid is linked:
-- SELECT email, role, branch_id, auth_uid IS NOT NULL AS linked
-- FROM app_users WHERE email LIKE 'test-%@martin.local';
-- Expected: 3 rows, all linked = true.
-- ============================================================

-- ============================================================
-- ROLLBACK (if you need to remove test users):
-- BEGIN;
-- DELETE FROM app_users WHERE email LIKE 'test-%@martin.local';
-- COMMIT;
-- Then delete the Auth users from the Dashboard.
-- ============================================================
