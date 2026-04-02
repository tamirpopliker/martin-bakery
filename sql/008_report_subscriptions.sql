-- ═══════════════════════════════════════════════════════════════════════
-- 008: Report & Alert Subscriptions — ניהול מנויים לדוחות והתראות
-- ═══════════════════════════════════════════════════════════════════════

-- 1. הוספת עמודות לטבלת app_users
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS report_daily BOOLEAN DEFAULT true;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS report_weekly BOOLEAN DEFAULT true;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS report_monthly BOOLEAN DEFAULT true;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS reports_enabled BOOLEAN DEFAULT true;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS alerts_enabled BOOLEAN DEFAULT true;

-- 2. טבלת הגדרות גלובליות
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Seed: הגדרות ברירת מחדל
INSERT INTO system_settings (key, value) VALUES
  ('reports_global_enabled', 'true'),
  ('alerts_global_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

-- 4. RLS
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Everyone can read system_settings" ON system_settings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage system_settings" ON system_settings
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users au
      WHERE au.auth_uid = auth.uid() AND au.role = 'admin'
    )
  );
