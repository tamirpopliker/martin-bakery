-- 038_hr_onboarding.sql
-- HR onboarding: configurable task templates + per-employee progress.

CREATE TABLE IF NOT EXISTS onboarding_task_templates (
  id            SERIAL PRIMARY KEY,
  label_he      TEXT NOT NULL,
  display_order INT DEFAULT 0,
  is_default    BOOLEAN DEFAULT false,
  active        BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now()
);

INSERT INTO onboarding_task_templates (label_he, display_order, is_default)
SELECT * FROM (VALUES
  ('חוזה עבודה נחתם',      1, true),
  ('טופס 101 הוגש',         2, true),
  ('פרטי בנק נרשמו',        3, true),
  ('צילום ת.ז התקבל',       4, true),
  ('הוראת קבע לשכר',       5, true),
  ('הוסף לקבוצת WhatsApp', 6, true)
) AS v(label_he, display_order, is_default)
WHERE NOT EXISTS (SELECT 1 FROM onboarding_task_templates WHERE is_default = true);

CREATE TABLE IF NOT EXISTS employee_onboarding (
  id               BIGSERIAL PRIMARY KEY,
  employee_kind    TEXT NOT NULL CHECK (employee_kind IN ('branch','factory')),
  employee_id      BIGINT NOT NULL,
  task_template_id INT REFERENCES onboarding_task_templates(id),
  task_label       TEXT NOT NULL,
  completed_at     TIMESTAMPTZ,
  completed_by     TEXT,
  notes            TEXT,
  UNIQUE (employee_kind, employee_id, task_template_id)
);

ALTER TABLE onboarding_task_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_onboarding       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "managers_read_onboarding_templates" ON onboarding_task_templates;
DROP POLICY IF EXISTS "admin_write_onboarding_templates"   ON onboarding_task_templates;

CREATE POLICY "managers_read_onboarding_templates" ON onboarding_task_templates FOR SELECT
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role IN ('admin','branch','factory')));
CREATE POLICY "admin_write_onboarding_templates" ON onboarding_task_templates FOR ALL
  USING      (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "hr_onboarding_all" ON employee_onboarding;

CREATE POLICY "hr_onboarding_all" ON employee_onboarding FOR ALL USING (
  EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin')
  OR (employee_kind = 'branch' AND EXISTS (
    SELECT 1 FROM app_users au JOIN branch_employees be ON be.id = employee_onboarding.employee_id
    WHERE au.auth_uid = auth.uid() AND au.role = 'branch'
      AND au.email NOT ILIKE '%@martin.local'
      AND au.branch_id = be.branch_id
  ))
  OR (employee_kind = 'factory' AND EXISTS (
    SELECT 1 FROM app_users au JOIN employees e ON e.id = employee_onboarding.employee_id
    WHERE au.auth_uid = auth.uid() AND au.role = 'factory'
      AND (au.managed_department IS NULL OR au.managed_department = e.department)
  ))
)
WITH CHECK (
  EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin')
  OR (employee_kind = 'branch' AND EXISTS (
    SELECT 1 FROM app_users au JOIN branch_employees be ON be.id = employee_onboarding.employee_id
    WHERE au.auth_uid = auth.uid() AND au.role = 'branch'
      AND au.email NOT ILIKE '%@martin.local'
      AND au.branch_id = be.branch_id
  ))
  OR (employee_kind = 'factory' AND EXISTS (
    SELECT 1 FROM app_users au JOIN employees e ON e.id = employee_onboarding.employee_id
    WHERE au.auth_uid = auth.uid() AND au.role = 'factory'
      AND (au.managed_department IS NULL OR au.managed_department = e.department)
  ))
);
