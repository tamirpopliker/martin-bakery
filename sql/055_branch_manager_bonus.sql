-- ═══════════════════════════════════════════════════════════════════════════
-- 055: Branch Manager Bonus KPI
-- ═══════════════════════════════════════════════════════════════════════════
-- Adds the per-branch bonus model + monthly approved-bonus log.
-- See src/pages/BonusKPI.tsx for the UI that reads/writes these tables.
--
-- Schema:
--   1. branches.manager_name  — display name of the current branch manager
--      (snapshot lives in branch_bonus_monthly.manager_name so renaming the
--      current manager doesn't rewrite history).
--   2. branch_bonus_models     — editable bonus model per branch:
--                                base_amount, threshold_pct, parameters JSONB
--                                where parameters is an array of KPI defs.
--   3. branch_bonus_monthly    — one row per (branch, month). Status moves
--                                draft → approved when the admin clicks
--                                "אשר ושמור". A full snapshot is stored so
--                                future edits to the model don't change
--                                historical approvals.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. manager_name on branches ───────────────────────────────────────────
ALTER TABLE branches ADD COLUMN IF NOT EXISTS manager_name TEXT;

UPDATE branches SET manager_name = 'אבי חורב'   WHERE name = 'סניף אברהם אבינו' AND (manager_name IS NULL OR manager_name = '');
UPDATE branches SET manager_name = 'קובי לוי'   WHERE name = 'סניף הפועלים'      AND (manager_name IS NULL OR manager_name = '');
UPDATE branches SET manager_name = 'זהר ספונוב' WHERE name = 'סניף יעקב כהן'      AND (manager_name IS NULL OR manager_name = '');

-- ── 2. branch_bonus_models ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS branch_bonus_models (
  branch_id     INT PRIMARY KEY REFERENCES branches(id) ON DELETE CASCADE,
  base_amount   NUMERIC NOT NULL DEFAULT 2000,
  threshold_pct NUMERIC NOT NULL DEFAULT 97,
  -- JSONB array. Each element shape:
  --   { id, name, weight, source, kind, target_field? }
  -- where:
  --   source ∈ 'auto' | 'manual'
  --   kind   ∈ 'higher_better' | 'lower_better' | 'binary'
  --   target_field ∈ branch_kpi_targets columns (revenue_target, labor_pct, ...)
  --                  required for source='auto'; ignored for 'manual'/'binary'.
  parameters    JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE branch_bonus_models ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "branch_bonus_models_admin_all" ON branch_bonus_models;
CREATE POLICY "branch_bonus_models_admin_all" ON branch_bonus_models FOR ALL
  USING (EXISTS (SELECT 1 FROM app_users u WHERE u.auth_uid = auth.uid() AND u.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM app_users u WHERE u.auth_uid = auth.uid() AND u.role = 'admin'));

-- Seed default model for each active branch, matching the screenshot:
--   25% sales, 25% labor, 10% waste, 25% basket, 7.5% mystery shopper, 7.5% safety audit.
-- Branches can edit/extend afterwards via the UI.
INSERT INTO branch_bonus_models (branch_id, base_amount, threshold_pct, parameters)
SELECT b.id, 2000, 97, '[
  { "id":"sales",       "name":"מכירות",                "weight":25,  "source":"auto",   "kind":"higher_better", "target_field":"revenue_target" },
  { "id":"labor",       "name":"ממוצע לייבור",          "weight":25,  "source":"auto",   "kind":"lower_better",  "target_field":"labor_pct" },
  { "id":"waste",       "name":"פחת ממוצע",             "weight":10,  "source":"auto",   "kind":"lower_better",  "target_field":"waste_pct" },
  { "id":"basket",      "name":"סל ממוצע",              "weight":25,  "source":"auto",   "kind":"higher_better", "target_field":"basket_target" },
  { "id":"mystery",     "name":"לקוח סמוי/דוח מנהל",     "weight":7.5, "source":"manual", "kind":"binary" },
  { "id":"safety",      "name":"ביקורות בטיחות מזון וניקיון", "weight":7.5, "source":"manual", "kind":"binary" }
]'::jsonb
FROM branches b
WHERE b.active = true
ON CONFLICT (branch_id) DO NOTHING;

-- ── 3. branch_bonus_monthly ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS branch_bonus_monthly (
  id             SERIAL PRIMARY KEY,
  branch_id      INT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  month          CHAR(7) NOT NULL,             -- 'YYYY-MM'
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved')),
  manager_name   TEXT NOT NULL,                -- snapshot at approval
  base_amount    NUMERIC NOT NULL,             -- snapshot
  threshold_pct  NUMERIC NOT NULL,             -- snapshot
  -- Per-KPI snapshot. Each element adds runtime data on top of the model def:
  --   { id, name, weight, source, kind, target_value, actual_value,
  --     achieved_pct, achieved (bool), bonus }
  parameters     JSONB NOT NULL,
  total_bonus    NUMERIC NOT NULL,
  approved_by    TEXT,
  approved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (branch_id, month)
);

CREATE INDEX IF NOT EXISTS branch_bonus_monthly_month_idx ON branch_bonus_monthly (month);
CREATE INDEX IF NOT EXISTS branch_bonus_monthly_branch_idx ON branch_bonus_monthly (branch_id);

ALTER TABLE branch_bonus_monthly ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "branch_bonus_monthly_admin_all" ON branch_bonus_monthly;
CREATE POLICY "branch_bonus_monthly_admin_all" ON branch_bonus_monthly FOR ALL
  USING (EXISTS (SELECT 1 FROM app_users u WHERE u.auth_uid = auth.uid() AND u.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM app_users u WHERE u.auth_uid = auth.uid() AND u.role = 'admin'));
