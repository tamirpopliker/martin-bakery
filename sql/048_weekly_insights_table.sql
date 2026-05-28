-- ═══════════════════════════════════════════════════════════════════════════
-- 048: Replace daily_insights with weekly_insights
-- ═══════════════════════════════════════════════════════════════════════════
-- The original design ran nightly; we switched to a Monday-morning weekly
-- review (covers the prior Sun-Sat). The schema changes:
--   - period_start (Sunday) + period_end (Saturday) replace `date`
--   - unique key is (period_end, entity_type, entity_id)
-- Same RLS model as the daily version (admin all, branch own, factory shared).
-- daily_insights had no production data so it's dropped.
-- ═══════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS daily_insights;

CREATE TABLE weekly_insights (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('branch', 'factory', 'consolidated')),
  entity_id       INT REFERENCES branches(id) ON DELETE CASCADE,
  insights        JSONB NOT NULL,
  metrics_snapshot JSONB NOT NULL,
  model           TEXT NOT NULL,
  input_tokens    INT,
  output_tokens   INT,
  cost_usd        NUMERIC(10, 6),
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT weekly_insights_unique_per_period UNIQUE (period_end, entity_type, entity_id),
  CONSTRAINT weekly_insights_valid_range CHECK (period_end >= period_start)
);

CREATE INDEX idx_weekly_insights_period_end ON weekly_insights (period_end DESC);
CREATE INDEX idx_weekly_insights_branch ON weekly_insights (entity_id, period_end DESC)
  WHERE entity_type = 'branch';

ALTER TABLE weekly_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_weekly_insights" ON weekly_insights;
CREATE POLICY "admin_all_weekly_insights" ON weekly_insights
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.auth_uid = auth.uid()
        AND app_users.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "branch_read_own_weekly_insights" ON weekly_insights;
CREATE POLICY "branch_read_own_weekly_insights" ON weekly_insights
  FOR SELECT
  USING (
    weekly_insights.entity_type = 'branch'
    AND EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.auth_uid = auth.uid()
        AND app_users.role = 'branch'
        AND app_users.branch_id = weekly_insights.entity_id
    )
  );

DROP POLICY IF EXISTS "factory_read_weekly_insights" ON weekly_insights;
CREATE POLICY "factory_read_weekly_insights" ON weekly_insights
  FOR SELECT
  USING (
    weekly_insights.entity_type IN ('factory', 'consolidated')
    AND EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.auth_uid = auth.uid()
        AND app_users.role = 'factory'
    )
  );

COMMENT ON TABLE weekly_insights IS
  'Weekly AI-generated business advisor insights. Populated by the weekly-insights Edge Function every Monday at 10:00 IST for the prior Sun-Sat. See sql/048_weekly_insights_table.sql for shape.';
