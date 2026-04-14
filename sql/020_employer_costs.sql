CREATE TABLE IF NOT EXISTS employer_costs (
  id SERIAL PRIMARY KEY,
  employee_number INT,
  employee_name TEXT,
  month INT NOT NULL,
  year INT NOT NULL,
  department_number INT,
  department_name TEXT,
  actual_employer_cost NUMERIC DEFAULT 0,
  actual_hours NUMERIC DEFAULT 0,
  actual_days NUMERIC DEFAULT 0,
  branch_id INT,
  is_headquarters BOOLEAN DEFAULT false,
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  uploaded_by TEXT
);

CREATE TABLE IF NOT EXISTS employer_costs_uploads (
  id SERIAL PRIMARY KEY,
  month INT,
  year INT,
  filename TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  uploaded_by TEXT,
  status TEXT DEFAULT 'completed',
  unmatched_count INT DEFAULT 0
);

ALTER TABLE employer_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE employer_costs_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_manage_employer_costs" ON employer_costs FOR ALL
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin'));
CREATE POLICY "admin_manage_employer_uploads" ON employer_costs_uploads FOR ALL
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin'));
