-- ═══════════════════════════════════════════════════════════════════════════
-- 052: Tighten insights RLS — exclude @martin.local username-auth users
-- ═══════════════════════════════════════════════════════════════════════════
-- @martin.local emails are synthetic, generated for permanent branch staff
-- (cashiers, etc.) who log in by username. They have a restricted scope and
-- should not see P&L commentary at all. The UI already hides the card for
-- them; this enforces the same rule at the API level.
--
-- Real-email branch users (the actual branch managers — Zohar, Avi, Kobi)
-- continue to see their own branch's insights.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "branch_read_own_insights" ON insights;
CREATE POLICY "branch_read_own_insights" ON insights
  FOR SELECT
  USING (
    insights.entity_type = 'branch'
    AND EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.auth_uid = auth.uid()
        AND app_users.role = 'branch'
        AND app_users.branch_id = insights.entity_id
        AND LOWER(app_users.email) NOT LIKE '%@martin.local'
    )
  );
