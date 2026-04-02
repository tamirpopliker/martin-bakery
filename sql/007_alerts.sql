-- ═══════════════════════════════════════════════════════════════════════
-- 007: Alerts — מערכת התרעות
-- ═══════════════════════════════════════════════════════════════════════

-- 1. טבלת כללי התרעות
CREATE TABLE IF NOT EXISTS alert_rules (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('branch', 'factory')),
  entity_id TEXT NOT NULL,
  metric TEXT NOT NULL CHECK (metric IN ('revenue', 'waste', 'labor_cost', 'production')),
  condition TEXT NOT NULL CHECK (condition IN ('below', 'above')),
  threshold NUMERIC NOT NULL,
  threshold_type TEXT NOT NULL DEFAULT 'absolute' CHECK (threshold_type IN ('absolute', 'percent')),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. טבלת לוג התרעות
CREATE TABLE IF NOT EXISTS alert_log (
  id SERIAL PRIMARY KEY,
  rule_id INT NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  triggered_at TIMESTAMPTZ DEFAULT now(),
  actual_value NUMERIC,
  threshold_value NUMERIC,
  email_sent BOOLEAN DEFAULT false,
  recipient_emails TEXT[] DEFAULT '{}'
);

-- 3. אינדקסים
CREATE INDEX IF NOT EXISTS idx_alert_log_rule_id ON alert_log(rule_id);
CREATE INDEX IF NOT EXISTS idx_alert_log_triggered_at ON alert_log(triggered_at);
CREATE INDEX IF NOT EXISTS idx_alert_rules_active ON alert_rules(active);

-- 4. RLS
ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Everyone can read alert_rules" ON alert_rules
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage alert_rules" ON alert_rules
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users au
      WHERE au.auth_uid = auth.uid() AND au.role = 'admin'
    )
  );

CREATE POLICY "Everyone can read alert_log" ON alert_log
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage alert_log" ON alert_log
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users au
      WHERE au.auth_uid = auth.uid() AND au.role = 'admin'
    )
  );
