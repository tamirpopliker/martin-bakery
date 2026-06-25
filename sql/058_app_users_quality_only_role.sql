-- 058_app_users_quality_only_role.sql
-- Add a new app_users role 'quality_only' for users who should ONLY see the
-- Quality Hub (customer complaints + freezer log) and nothing else.
-- Also extends the freezer_log RLS policies to grant access to this role.

-- ─── Role constraint ───────────────────────────────────────────────────────
ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
ALTER TABLE app_users ADD CONSTRAINT app_users_role_check
  CHECK (role IN ('admin', 'factory', 'branch', 'employee', 'scheduler', 'quality_only'));

-- ─── Freezer log RLS: include 'quality_only' ───────────────────────────────
-- (customer_complaints already allows any authenticated app_user, no change.)

DROP POLICY IF EXISTS "freezer_readings_read"   ON freezer_readings;
DROP POLICY IF EXISTS "freezer_readings_insert" ON freezer_readings;
DROP POLICY IF EXISTS "freezer_readings_update" ON freezer_readings;

CREATE POLICY "freezer_readings_read" ON freezer_readings FOR SELECT
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role IN ('admin','factory','quality_only')));

CREATE POLICY "freezer_readings_insert" ON freezer_readings FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role IN ('admin','factory','quality_only')));

CREATE POLICY "freezer_readings_update" ON freezer_readings FOR UPDATE
  USING      (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role IN ('admin','factory','quality_only')))
  WITH CHECK (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role IN ('admin','factory','quality_only')));

-- delete remains admin-only (compliance trail).
