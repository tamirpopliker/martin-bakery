-- ═══════════════════════════════════════════════════════════════════════
-- 022: Enable RLS + SELECT policy on labor table
-- ═══════════════════════════════════════════════════════════════════════

-- Step 1: Check existing policies (run this SELECT first to see what exists)
-- SELECT policyname, cmd, roles, qual FROM pg_policies WHERE tablename = 'labor';

-- Step 2: Enable RLS (safe to run even if already enabled)
ALTER TABLE labor ENABLE ROW LEVEL SECURITY;

-- Step 3: Create read policy
CREATE POLICY "authenticated users can read labor employee names"
ON labor FOR SELECT
TO authenticated
USING (true);
