-- 060_factory_closing_checklists.sql
-- Daily factory closing checklist (~60 binary items grouped by room) +
-- 7 embedded temperature fields that stream into the existing
-- freezer_readings table (no schema change there). One row per closing_date.

CREATE TABLE IF NOT EXISTS factory_closing_checklists (
  id                BIGSERIAL PRIMARY KEY,
  closing_date      DATE NOT NULL UNIQUE,
  signed_by_user_id UUID,
  signed_by_name    TEXT NOT NULL,
  checklist_data    JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_factory_closing_date
  ON factory_closing_checklists (closing_date DESC);

CREATE OR REPLACE FUNCTION set_factory_closing_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_factory_closing_updated_at ON factory_closing_checklists;
CREATE TRIGGER trg_factory_closing_updated_at
  BEFORE UPDATE ON factory_closing_checklists
  FOR EACH ROW EXECUTE FUNCTION set_factory_closing_updated_at();

ALTER TABLE factory_closing_checklists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fcc_read"   ON factory_closing_checklists;
DROP POLICY IF EXISTS "fcc_insert" ON factory_closing_checklists;
DROP POLICY IF EXISTS "fcc_update" ON factory_closing_checklists;
DROP POLICY IF EXISTS "fcc_delete" ON factory_closing_checklists;

CREATE POLICY "fcc_read" ON factory_closing_checklists FOR SELECT
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role IN ('admin','factory','quality_only')));

CREATE POLICY "fcc_insert" ON factory_closing_checklists FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role IN ('admin','factory','quality_only')));

CREATE POLICY "fcc_update" ON factory_closing_checklists FOR UPDATE
  USING      (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role IN ('admin','factory','quality_only')))
  WITH CHECK (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role IN ('admin','factory','quality_only')));

CREATE POLICY "fcc_delete" ON factory_closing_checklists FOR DELETE
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin'));
