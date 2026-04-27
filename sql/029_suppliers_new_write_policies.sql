-- Migration 029: write policies for suppliers_new
-- Migration 027 enabled RLS on suppliers_new but only admin had INSERT/UPDATE/DELETE.
-- factory and branch users got "new row violates row-level security policy" when adding suppliers.
-- This migration adds scoped write policies:
--   - factory role: full CRUD on scope='factory' rows
--   - branch role:  full CRUD on scope='branch' rows for their own branch_id
-- Shared-scope and cross-branch writes remain admin-only (covered by existing admin_all_suppliers_new).

BEGIN;

-- factory: write own scope
DROP POLICY IF EXISTS "factory_write_suppliers_new" ON suppliers_new;
CREATE POLICY "factory_write_suppliers_new" ON suppliers_new
  FOR ALL TO authenticated
  USING (
    scope = 'factory'
    AND EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'factory')
  )
  WITH CHECK (
    scope = 'factory'
    AND EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'factory')
  );

-- branch: write own branch
DROP POLICY IF EXISTS "branch_write_suppliers_new" ON suppliers_new;
CREATE POLICY "branch_write_suppliers_new" ON suppliers_new
  FOR ALL TO authenticated
  USING (
    scope = 'branch'
    AND branch_id = (
      SELECT branch_id FROM app_users WHERE auth_uid = auth.uid() AND role = 'branch' LIMIT 1
    )
  )
  WITH CHECK (
    scope = 'branch'
    AND branch_id = (
      SELECT branch_id FROM app_users WHERE auth_uid = auth.uid() AND role = 'branch' LIMIT 1
    )
  );

COMMIT;

-- ============================================================
-- ROLLBACK (run separately if needed):
-- BEGIN;
-- DROP POLICY IF EXISTS "factory_write_suppliers_new" ON suppliers_new;
-- DROP POLICY IF EXISTS "branch_write_suppliers_new"  ON suppliers_new;
-- COMMIT;
-- ============================================================

-- ============================================================
-- SANITY CHECKS (run separately to verify):
--
-- SELECT policyname, cmd, qual, with_check
-- FROM pg_policies
-- WHERE tablename = 'suppliers_new'
-- ORDER BY policyname;
--
-- Expected: 5 policies total
--   admin_all_suppliers_new       (FOR ALL,    admin)
--   branch_read_suppliers_new     (FOR SELECT, branch — own branch + shared)
--   branch_write_suppliers_new    (FOR ALL,    branch — own branch only)        <-- NEW
--   factory_read_suppliers_new    (FOR SELECT, factory — factory + shared)
--   factory_write_suppliers_new   (FOR ALL,    factory — factory only)          <-- NEW
-- ============================================================
