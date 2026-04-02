-- ═══════════════════════════════════════════════════════════════════════
-- 009: Branch Employees — עובדי סניף
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS branch_employees (
  id SERIAL PRIMARY KEY,
  branch_id INT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  hourly_rate NUMERIC,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_branch_employees_branch ON branch_employees(branch_id);
CREATE INDEX IF NOT EXISTS idx_branch_employees_name ON branch_employees(name);

ALTER TABLE branch_employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Everyone can read branch_employees" ON branch_employees
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage branch_employees" ON branch_employees
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users au
      WHERE au.auth_uid = auth.uid() AND (au.role = 'admin' OR au.role = 'branch')
    )
  );
