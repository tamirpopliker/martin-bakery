-- 039_hr_audit_log.sql
-- HR audit trail: log every INSERT/UPDATE/DELETE on the four HR tables.

CREATE TABLE IF NOT EXISTS hr_audit_log (
  id               BIGSERIAL PRIMARY KEY,
  table_name       TEXT NOT NULL,
  row_id           TEXT NOT NULL,            -- TEXT: covers BIGINT (branch_employees) and INT (employees)
  employee_kind    TEXT,
  employee_id      BIGINT,
  operation        TEXT NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
  changed_fields   JSONB,
  changed_by       UUID,
  changed_by_email TEXT,
  changed_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hr_audit_employee
  ON hr_audit_log (employee_kind, employee_id, changed_at DESC);

CREATE OR REPLACE FUNCTION hr_log_audit() RETURNS TRIGGER AS $$
DECLARE
  _diff     JSONB := '{}'::jsonb;
  _key      TEXT;
  _email    TEXT;
  _emp_kind TEXT;
  _emp_id   BIGINT;
  _row_id   TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    FOR _key IN SELECT jsonb_object_keys(to_jsonb(NEW)) LOOP
      IF to_jsonb(NEW) -> _key IS DISTINCT FROM to_jsonb(OLD) -> _key THEN
        _diff := _diff || jsonb_build_object(_key, jsonb_build_object(
          'old', to_jsonb(OLD) -> _key,
          'new', to_jsonb(NEW) -> _key
        ));
      END IF;
    END LOOP;
    IF _diff = '{}'::jsonb THEN RETURN NEW; END IF;
  ELSIF TG_OP = 'INSERT' THEN
    _diff := to_jsonb(NEW);
  ELSIF TG_OP = 'DELETE' THEN
    _diff := to_jsonb(OLD);
  END IF;

  SELECT email INTO _email FROM app_users WHERE auth_uid = auth.uid() LIMIT 1;

  IF TG_TABLE_NAME = 'branch_employees' THEN
    _emp_kind := 'branch';
    _emp_id   := COALESCE((NEW).id, (OLD).id);
    _row_id   := COALESCE((NEW).id, (OLD).id)::text;
  ELSIF TG_TABLE_NAME = 'employees' THEN
    _emp_kind := 'factory';
    _emp_id   := COALESCE((NEW).id, (OLD).id);
    _row_id   := COALESCE((NEW).id, (OLD).id)::text;
  ELSIF TG_TABLE_NAME IN ('employee_documents','employee_onboarding') THEN
    _emp_kind := COALESCE((NEW).employee_kind, (OLD).employee_kind);
    _emp_id   := COALESCE((NEW).employee_id,   (OLD).employee_id);
    _row_id   := COALESCE((NEW).id, (OLD).id)::text;
  END IF;

  INSERT INTO hr_audit_log
    (table_name, row_id, employee_kind, employee_id, operation, changed_fields, changed_by, changed_by_email)
  VALUES
    (TG_TABLE_NAME, _row_id, _emp_kind, _emp_id, TG_OP, _diff, auth.uid(), _email);

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS hr_audit_branch_employees ON branch_employees;
CREATE TRIGGER hr_audit_branch_employees
  AFTER INSERT OR UPDATE OR DELETE ON branch_employees
  FOR EACH ROW EXECUTE FUNCTION hr_log_audit();

DROP TRIGGER IF EXISTS hr_audit_employees ON employees;
CREATE TRIGGER hr_audit_employees
  AFTER INSERT OR UPDATE OR DELETE ON employees
  FOR EACH ROW EXECUTE FUNCTION hr_log_audit();

DROP TRIGGER IF EXISTS hr_audit_employee_documents ON employee_documents;
CREATE TRIGGER hr_audit_employee_documents
  AFTER INSERT OR UPDATE OR DELETE ON employee_documents
  FOR EACH ROW EXECUTE FUNCTION hr_log_audit();

DROP TRIGGER IF EXISTS hr_audit_employee_onboarding ON employee_onboarding;
CREATE TRIGGER hr_audit_employee_onboarding
  AFTER INSERT OR UPDATE OR DELETE ON employee_onboarding
  FOR EACH ROW EXECUTE FUNCTION hr_log_audit();

ALTER TABLE hr_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hr_audit_read" ON hr_audit_log;

CREATE POLICY "hr_audit_read" ON hr_audit_log FOR SELECT USING (
  EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin')
  OR (employee_kind = 'branch' AND EXISTS (
    SELECT 1 FROM app_users au JOIN branch_employees be ON be.id = hr_audit_log.employee_id
    WHERE au.auth_uid = auth.uid() AND au.role = 'branch'
      AND au.email NOT ILIKE '%@martin.local'
      AND au.branch_id = be.branch_id
  ))
  OR (employee_kind = 'factory' AND EXISTS (
    SELECT 1 FROM app_users au JOIN employees e ON e.id = hr_audit_log.employee_id
    WHERE au.auth_uid = auth.uid() AND au.role = 'factory'
      AND (au.managed_department IS NULL OR au.managed_department = e.department)
  ))
);
