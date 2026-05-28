-- ═══════════════════════════════════════════════════════════════════════════
-- 045: Daily business-advisor insights table
-- ═══════════════════════════════════════════════════════════════════════════
-- One row per entity per day, populated by the `daily-insights` Edge Function
-- which runs nightly at 22:00. The Edge Function pre-aggregates revenue,
-- labor, waste, suppliers, and P&L margins in SQL, sends a compact JSON
-- summary to Claude (Haiku 4.5), and stores the structured response here.
--
-- Insights shape (jsonb):
--   {
--     "headline":  "<one-line summary>",
--     "alerts":    [{ "severity": "high|medium|low", "metric": "<key>",
--                     "message": "<hebrew>", "recommendation": "<hebrew>" }],
--     "wins":      ["<hebrew>", ...],
--     "summary":   "<short hebrew paragraph>"
--   }
--
-- Entities:
--   - entity_type='branch'        → entity_id = branch_id  (per-branch view)
--   - entity_type='factory'       → entity_id = NULL
--   - entity_type='consolidated'  → entity_id = NULL       (whole-company view)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS daily_insights (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date            DATE NOT NULL,
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('branch', 'factory', 'consolidated')),
  entity_id       INT REFERENCES branches(id) ON DELETE CASCADE,  -- NULL for factory/consolidated
  insights        JSONB NOT NULL,
  metrics_snapshot JSONB NOT NULL,    -- the aggregated data we sent to Claude (for audit/debug)
  model           TEXT NOT NULL,      -- e.g. 'claude-haiku-4-5'
  input_tokens    INT,
  output_tokens   INT,
  cost_usd        NUMERIC(10, 6),     -- computed cost of this generation
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Ensure one insight per (entity, day). Re-runs replace the existing row.
  CONSTRAINT daily_insights_unique_per_day UNIQUE (date, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_insights_date ON daily_insights (date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_insights_branch ON daily_insights (entity_id, date DESC)
  WHERE entity_type = 'branch';

-- ─── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE daily_insights ENABLE ROW LEVEL SECURITY;

-- Admin: full access
DROP POLICY IF EXISTS "admin_all_daily_insights" ON daily_insights;
CREATE POLICY "admin_all_daily_insights" ON daily_insights
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.auth_uid = auth.uid()
        AND app_users.role = 'admin'
    )
  );

-- Branch users: SELECT only their own branch's rows
DROP POLICY IF EXISTS "branch_read_own_daily_insights" ON daily_insights;
CREATE POLICY "branch_read_own_daily_insights" ON daily_insights
  FOR SELECT
  USING (
    daily_insights.entity_type = 'branch'
    AND EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.auth_uid = auth.uid()
        AND app_users.role = 'branch'
        AND app_users.branch_id = daily_insights.entity_id
    )
  );

-- Factory users: SELECT factory + consolidated rows
DROP POLICY IF EXISTS "factory_read_daily_insights" ON daily_insights;
CREATE POLICY "factory_read_daily_insights" ON daily_insights
  FOR SELECT
  USING (
    daily_insights.entity_type IN ('factory', 'consolidated')
    AND EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.auth_uid = auth.uid()
        AND app_users.role = 'factory'
    )
  );

COMMENT ON TABLE daily_insights IS
  'Daily AI-generated business advisor insights. Populated by the daily-insights Edge Function at 22:00 IST. See sql/045_daily_insights.sql for the insights jsonb shape.';
