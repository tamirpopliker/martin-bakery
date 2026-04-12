-- Branch communication center
CREATE TABLE IF NOT EXISTS branch_messages (
  id SERIAL PRIMARY KEY,
  branch_id INT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  type TEXT NOT NULL DEFAULT 'info' CHECK (type IN ('urgent', 'task', 'info', 'praise')),
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  scheduled_at TIMESTAMPTZ,
  is_pinned BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS message_reads (
  id SERIAL PRIMARY KEY,
  message_id INT NOT NULL REFERENCES branch_messages(id) ON DELETE CASCADE,
  employee_id INT NOT NULL,
  read_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(message_id, employee_id)
);

ALTER TABLE branch_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "branch_manage_messages" ON branch_messages FOR ALL
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role IN ('admin', 'branch', 'employee')));
CREATE POLICY "branch_manage_reads" ON message_reads FOR ALL
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role IN ('admin', 'branch', 'employee')));
