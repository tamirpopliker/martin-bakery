-- ═══════════════════════════════════════════════════════════════════════
-- 011: Fix RLS policies for branch_kpi_targets
-- Problem: INSERT is blocked by RLS, preventing new KPI targets from being saved
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Enable RLS (safe to run even if already enabled)
ALTER TABLE branch_kpi_targets ENABLE ROW LEVEL SECURITY;

-- 2. Drop existing policies to avoid conflicts (safe if they don't exist)
DROP POLICY IF EXISTS "Allow authenticated select" ON branch_kpi_targets;
DROP POLICY IF EXISTS "Allow authenticated insert" ON branch_kpi_targets;
DROP POLICY IF EXISTS "Allow authenticated update" ON branch_kpi_targets;
DROP POLICY IF EXISTS "Allow authenticated delete" ON branch_kpi_targets;

-- 3. Create full CRUD policies for authenticated users
CREATE POLICY "Allow authenticated select" ON branch_kpi_targets
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated insert" ON branch_kpi_targets
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated update" ON branch_kpi_targets
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated delete" ON branch_kpi_targets
  FOR DELETE TO authenticated USING (true);

-- 4. Ensure branch_id has a UNIQUE constraint (needed for upsert onConflict)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'branch_kpi_targets_branch_id_key'
  ) THEN
    ALTER TABLE branch_kpi_targets ADD CONSTRAINT branch_kpi_targets_branch_id_key UNIQUE (branch_id);
  END IF;
END $$;
