-- 057_freezer_log.sql
-- Daily temperature monitoring for factory fridges & freezers (HACCP).

CREATE TABLE IF NOT EXISTS freezer_units (
  id            SERIAL PRIMARY KEY,
  key           TEXT UNIQUE NOT NULL,
  label_he      TEXT NOT NULL,
  unit_type     TEXT NOT NULL CHECK (unit_type IN ('fridge','freezer')),
  max_c         NUMERIC(5,2) NOT NULL,
  display_order INT DEFAULT 0,
  active        BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now()
);

INSERT INTO freezer_units (key, label_he, unit_type, max_c, display_order) VALUES
  ('fridge_raw',         'מקרר חומרי גלם',          'fridge',  5,   1),
  ('fridge_dough_wip',   'מקרר בתהליך בצקים',       'fridge',  5,   2),
  ('freezer_dough_wip',  'מקפיא בתהליך בצקים',      'freezer', -13, 3),
  ('fridge_creams_wip',  'מקרר בתהליך קרמים',       'fridge',  5,   4),
  ('freezer_creams_wip', 'מקפיא בתהליך קרמים',      'freezer', -13, 5),
  ('freezer_creams_fg',  'מקפיא תוצ״ג קרמים',        'freezer', -13, 6),
  ('freezer_dough_fg',   'מקפיא תוצ״ג בצקים',        'freezer', -13, 7)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS freezer_readings (
  id                   BIGSERIAL PRIMARY KEY,
  unit_id              INT NOT NULL REFERENCES freezer_units(id),
  reading_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  temperature_c        NUMERIC(5,2) NOT NULL,
  notes                TEXT,
  measured_by_user_id  UUID,
  measured_by_name     TEXT NOT NULL,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now(),
  UNIQUE (unit_id, reading_date)
);

CREATE INDEX IF NOT EXISTS idx_freezer_readings_date
  ON freezer_readings (reading_date DESC);

CREATE OR REPLACE FUNCTION set_freezer_readings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_freezer_readings_updated_at ON freezer_readings;
CREATE TRIGGER trg_freezer_readings_updated_at
  BEFORE UPDATE ON freezer_readings
  FOR EACH ROW EXECUTE FUNCTION set_freezer_readings_updated_at();

ALTER TABLE freezer_units    ENABLE ROW LEVEL SECURITY;
ALTER TABLE freezer_readings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "freezer_units_read"  ON freezer_units;
DROP POLICY IF EXISTS "freezer_units_write" ON freezer_units;

CREATE POLICY "freezer_units_read" ON freezer_units FOR SELECT
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid()));

CREATE POLICY "freezer_units_write" ON freezer_units FOR ALL
  USING      (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "freezer_readings_read"   ON freezer_readings;
DROP POLICY IF EXISTS "freezer_readings_insert" ON freezer_readings;
DROP POLICY IF EXISTS "freezer_readings_update" ON freezer_readings;
DROP POLICY IF EXISTS "freezer_readings_delete" ON freezer_readings;

CREATE POLICY "freezer_readings_read" ON freezer_readings FOR SELECT
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role IN ('admin','factory')));

CREATE POLICY "freezer_readings_insert" ON freezer_readings FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role IN ('admin','factory')));

CREATE POLICY "freezer_readings_update" ON freezer_readings FOR UPDATE
  USING      (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role IN ('admin','factory')))
  WITH CHECK (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role IN ('admin','factory')));

CREATE POLICY "freezer_readings_delete" ON freezer_readings FOR DELETE
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin'));
