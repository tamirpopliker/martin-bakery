-- External B2B sales with PDF invoice extraction
CREATE TABLE IF NOT EXISTS external_sales (
  id SERIAL PRIMARY KEY,
  customer_name TEXT NOT NULL,
  invoice_number TEXT,
  invoice_date DATE NOT NULL,
  total_before_vat NUMERIC NOT NULL DEFAULT 0,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE external_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_factory_manage_external_sales" ON external_sales FOR ALL
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role IN ('admin', 'factory')));
