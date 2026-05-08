-- 037_hr_documents_schema.sql
-- HR documents: document_types catalog + employee_documents + tiered RLS.

CREATE TABLE IF NOT EXISTS document_types (
  id            SERIAL PRIMARY KEY,
  key           TEXT UNIQUE NOT NULL,
  label_he      TEXT NOT NULL,
  is_default    BOOLEAN DEFAULT false,
  display_order INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now()
);

INSERT INTO document_types (key, label_he, is_default, display_order) VALUES
  ('kit_klita',   'קיט קליטה',         true,  1),
  ('form_101',    'טופס 101',          true,  2),
  ('contract',    'חוזה עבודה חתום',  true,  3),
  ('id_copy',     'צילום תעודת זהות',  false, 4),
  ('bank_letter', 'אישור פרטי בנק',    false, 5)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS employee_documents (
  id                    BIGSERIAL PRIMARY KEY,
  employee_kind         TEXT NOT NULL CHECK (employee_kind IN ('branch','factory')),
  employee_id           BIGINT NOT NULL,
  document_type_id      INT  REFERENCES document_types(id),
  document_type_label   TEXT NOT NULL,
  file_name             TEXT NOT NULL,
  file_url              TEXT NOT NULL,
  file_size             INT,
  uploaded_at           TIMESTAMPTZ DEFAULT now(),
  uploaded_by           TEXT,
  notes                 TEXT
);
CREATE INDEX IF NOT EXISTS idx_employee_documents_emp
  ON employee_documents (employee_kind, employee_id);

ALTER TABLE document_types     ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "managers_read_document_types" ON document_types;
DROP POLICY IF EXISTS "admin_write_document_types"   ON document_types;
DROP POLICY IF EXISTS "admin_update_document_types"  ON document_types;
DROP POLICY IF EXISTS "admin_delete_document_types"  ON document_types;

CREATE POLICY "managers_read_document_types" ON document_types FOR SELECT
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role IN ('admin','branch','factory')));
CREATE POLICY "admin_write_document_types" ON document_types FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin'));
CREATE POLICY "admin_update_document_types" ON document_types FOR UPDATE
  USING      (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin'));
CREATE POLICY "admin_delete_document_types" ON document_types FOR DELETE
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "hr_documents_read"   ON employee_documents;
DROP POLICY IF EXISTS "hr_documents_write"  ON employee_documents;
DROP POLICY IF EXISTS "hr_documents_delete" ON employee_documents;

CREATE POLICY "hr_documents_read" ON employee_documents FOR SELECT USING (
  EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin')
  OR (employee_kind = 'branch' AND EXISTS (
    SELECT 1 FROM app_users au JOIN branch_employees be ON be.id = employee_documents.employee_id
    WHERE au.auth_uid = auth.uid() AND au.role = 'branch'
      AND au.email NOT ILIKE '%@martin.local'
      AND au.branch_id = be.branch_id
  ))
  OR (employee_kind = 'factory' AND EXISTS (
    SELECT 1 FROM app_users au JOIN employees e ON e.id = employee_documents.employee_id
    WHERE au.auth_uid = auth.uid() AND au.role = 'factory'
      AND (au.managed_department IS NULL OR au.managed_department = e.department)
  ))
);
CREATE POLICY "hr_documents_write" ON employee_documents FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin')
  OR (employee_kind = 'branch' AND EXISTS (
    SELECT 1 FROM app_users au JOIN branch_employees be ON be.id = employee_documents.employee_id
    WHERE au.auth_uid = auth.uid() AND au.role = 'branch'
      AND au.email NOT ILIKE '%@martin.local'
      AND au.branch_id = be.branch_id
  ))
  OR (employee_kind = 'factory' AND EXISTS (
    SELECT 1 FROM app_users au JOIN employees e ON e.id = employee_documents.employee_id
    WHERE au.auth_uid = auth.uid() AND au.role = 'factory'
      AND (au.managed_department IS NULL OR au.managed_department = e.department)
  ))
);
CREATE POLICY "hr_documents_delete" ON employee_documents FOR DELETE USING (
  EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin')
  OR (employee_kind = 'branch' AND EXISTS (
    SELECT 1 FROM app_users au JOIN branch_employees be ON be.id = employee_documents.employee_id
    WHERE au.auth_uid = auth.uid() AND au.role = 'branch'
      AND au.email NOT ILIKE '%@martin.local'
      AND au.branch_id = be.branch_id
  ))
  OR (employee_kind = 'factory' AND EXISTS (
    SELECT 1 FROM app_users au JOIN employees e ON e.id = employee_documents.employee_id
    WHERE au.auth_uid = auth.uid() AND au.role = 'factory'
      AND (au.managed_department IS NULL OR au.managed_department = e.department)
  ))
);
