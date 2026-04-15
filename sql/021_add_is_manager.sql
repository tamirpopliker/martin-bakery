-- ═══════════════════════════════════════════════════════════════════════
-- 021: Add is_manager column to employer_costs
-- Used by calculatePL.ts and supabase.ts to split labor into
-- regular employee costs vs manager salary for branch P&L reports.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE employer_costs ADD COLUMN IF NOT EXISTS is_manager BOOLEAN DEFAULT false;
