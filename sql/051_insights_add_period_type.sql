-- ═══════════════════════════════════════════════════════════════════════════
-- 051: Rename weekly_insights → insights, add period_type column
-- ═══════════════════════════════════════════════════════════════════════════
-- The agent now supports both weekly and monthly analysis. Renaming the table
-- to `insights` removes the misleading "weekly" name. period_type lets the UI
-- filter by cadence without inferring from period_start/end span.
--
-- Existing rows are tagged 'weekly' (they were all weekly Sun–Sat).
-- New unique key includes period_type so a weekly and a monthly insight for
-- the same entity ending on the same date can coexist.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE weekly_insights RENAME TO insights;

ALTER TABLE insights ADD COLUMN IF NOT EXISTS period_type TEXT NOT NULL
  DEFAULT 'weekly'
  CHECK (period_type IN ('weekly', 'monthly'));

-- Drop the weekly-specific unique constraint and replace with one that
-- includes period_type so weekly+monthly insights for the same period_end
-- don't collide.
ALTER TABLE insights DROP CONSTRAINT IF EXISTS weekly_insights_unique_per_period;
ALTER TABLE insights ADD CONSTRAINT insights_unique_per_period
  UNIQUE (period_end, period_type, entity_type, entity_id);

-- Index renames (PostgreSQL renames the implicit constraint index automatically,
-- but our manually-created indexes need help)
ALTER INDEX IF EXISTS idx_weekly_insights_period_end RENAME TO idx_insights_period_end;
ALTER INDEX IF EXISTS idx_weekly_insights_branch RENAME TO idx_insights_branch;

-- ─── RLS policy rename ──────────────────────────────────────────────────────
-- Policy names are tied to the (now-renamed) table. Drop & recreate with
-- updated names so future migrations are searchable.
DROP POLICY IF EXISTS "admin_all_weekly_insights" ON insights;
CREATE POLICY "admin_all_insights" ON insights
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.auth_uid = auth.uid()
        AND app_users.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "branch_read_own_weekly_insights" ON insights;
CREATE POLICY "branch_read_own_insights" ON insights
  FOR SELECT
  USING (
    insights.entity_type = 'branch'
    AND EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.auth_uid = auth.uid()
        AND app_users.role = 'branch'
        AND app_users.branch_id = insights.entity_id
    )
  );

DROP POLICY IF EXISTS "factory_read_weekly_insights" ON insights;
CREATE POLICY "factory_read_insights" ON insights
  FOR SELECT
  USING (
    insights.entity_type IN ('factory', 'consolidated')
    AND EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.auth_uid = auth.uid()
        AND app_users.role = 'factory'
    )
  );

COMMENT ON TABLE insights IS
  'AI business-advisor insights. Populated by the weekly-insights Edge Function (weekly cron Mondays 10:00 IST + manual monthly trigger). period_type distinguishes weekly Sun-Sat vs full calendar month.';
