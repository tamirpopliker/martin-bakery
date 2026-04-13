CREATE TABLE IF NOT EXISTS scheduled_messages (
  id SERIAL PRIMARY KEY,
  branch_id INT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  type TEXT NOT NULL DEFAULT 'info',
  recipient_type TEXT DEFAULT 'all',
  recipient_id INT,
  recipient_role TEXT,
  schedule_type TEXT NOT NULL DEFAULT 'weekly',
  days_of_week INT[] DEFAULT '{}',
  specific_dates DATE[],
  send_time TEXT DEFAULT '07:00',
  is_active BOOLEAN DEFAULT true,
  last_sent_at TIMESTAMPTZ,
  next_send_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scheduled_message_log (
  id SERIAL PRIMARY KEY,
  scheduled_message_id INT NOT NULL REFERENCES scheduled_messages(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ DEFAULT now(),
  recipients_count INT DEFAULT 0,
  reads_count INT DEFAULT 0
);

ALTER TABLE scheduled_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_message_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "branch_manage_scheduled" ON scheduled_messages FOR ALL
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role IN ('admin','branch')));
CREATE POLICY "branch_read_scheduled_log" ON scheduled_message_log FOR ALL
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role IN ('admin','branch')));
