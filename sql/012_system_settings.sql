-- System settings table for global configuration values
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Default overhead percentage
INSERT INTO system_settings (key, value)
VALUES ('overhead_pct', '5')
ON CONFLICT (key) DO NOTHING;

-- RLS
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated select" ON system_settings;
CREATE POLICY "Allow authenticated select" ON system_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated update" ON system_settings;
CREATE POLICY "Allow authenticated update" ON system_settings
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated insert" ON system_settings;
CREATE POLICY "Allow authenticated insert" ON system_settings
  FOR INSERT TO authenticated WITH CHECK (true);
