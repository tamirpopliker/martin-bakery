-- 056_customer_complaints.sql
-- Customer complaints tracking (form 0701) — accessible to all authenticated app_users.

CREATE TABLE IF NOT EXISTS customer_complaints (
  id                    BIGSERIAL PRIMARY KEY,
  received_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  recipient_user_id     UUID,
  recipient_name        TEXT NOT NULL,
  source_kind           TEXT CHECK (source_kind IN ('branch','factory','hq','admin')),
  source_branch_id      INT REFERENCES branches(id),

  complainant_name      TEXT NOT NULL,
  complainant_phone     TEXT,
  complainant_email     TEXT,
  complainant_address   TEXT,

  product_name          TEXT,
  production_date       DATE,
  expiry_date           DATE,

  description           TEXT NOT NULL,
  response              TEXT,

  status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_at             TIMESTAMPTZ,
  closed_by_user_id     UUID,
  closed_by_name        TEXT,

  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_complaints_status_date
  ON customer_complaints (status, received_date DESC);
CREATE INDEX IF NOT EXISTS idx_customer_complaints_branch
  ON customer_complaints (source_branch_id) WHERE source_branch_id IS NOT NULL;

CREATE OR REPLACE FUNCTION set_customer_complaints_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_customer_complaints_updated_at ON customer_complaints;
CREATE TRIGGER trg_customer_complaints_updated_at
  BEFORE UPDATE ON customer_complaints
  FOR EACH ROW EXECUTE FUNCTION set_customer_complaints_updated_at();

ALTER TABLE customer_complaints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "complaints_read_all_authed"    ON customer_complaints;
DROP POLICY IF EXISTS "complaints_insert_all_authed"  ON customer_complaints;
DROP POLICY IF EXISTS "complaints_update_all_authed"  ON customer_complaints;
DROP POLICY IF EXISTS "complaints_delete_admin_only"  ON customer_complaints;

CREATE POLICY "complaints_read_all_authed" ON customer_complaints FOR SELECT
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid()));

CREATE POLICY "complaints_insert_all_authed" ON customer_complaints FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid()));

CREATE POLICY "complaints_update_all_authed" ON customer_complaints FOR UPDATE
  USING      (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid()));

CREATE POLICY "complaints_delete_admin_only" ON customer_complaints FOR DELETE
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin'));
