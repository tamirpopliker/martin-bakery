-- ═══════════════════════════════════════════════════════════════════════════
-- 044: Allow branch users to SELECT their own branch's employer_costs rows
-- ═══════════════════════════════════════════════════════════════════════════
-- Until now, RLS allowed only admin to access employer_costs. Branch
-- managers (role='branch') got zero rows back from any query, so
-- calculateBranchPL silently fell through to the `branch_labor` /
-- fixed_costs.mgmt fallback path — meaning their own dashboard showed
-- stale labor numbers and never picked up manager-flag corrections
-- made by admin.
--
-- This policy lets each branch user SELECT employer_costs rows for
-- their assigned branch_id only. INSERT/UPDATE/DELETE remain admin-only
-- via the pre-existing policy 020.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "branch_read_own_employer_costs" ON employer_costs;

CREATE POLICY "branch_read_own_employer_costs" ON employer_costs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.auth_uid = auth.uid()
        AND app_users.role = 'branch'
        AND app_users.branch_id = employer_costs.branch_id
    )
  );
