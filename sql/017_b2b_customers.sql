-- B2B credit customers module
CREATE TABLE IF NOT EXISTS b2b_customers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  company_number TEXT,
  phone TEXT,
  address TEXT,
  branch_id INT,
  credit_limit NUMERIC DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS b2b_invoices (
  id SERIAL PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES b2b_customers(id) ON DELETE CASCADE,
  invoice_number TEXT,
  invoice_date DATE NOT NULL,
  due_date DATE,
  total_before_vat NUMERIC NOT NULL DEFAULT 0,
  total_with_vat NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'partial', 'paid', 'overdue')),
  branch_id INT,
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  uploaded_by TEXT
);

CREATE TABLE IF NOT EXISTS b2b_payments (
  id SERIAL PRIMARY KEY,
  invoice_id INT NOT NULL REFERENCES b2b_invoices(id) ON DELETE CASCADE,
  payment_date DATE NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE b2b_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE b2b_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE b2b_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_manage_b2b_customers" ON b2b_customers FOR ALL
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin'));
CREATE POLICY "admin_manage_b2b_invoices" ON b2b_invoices FOR ALL
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin'));
CREATE POLICY "admin_manage_b2b_payments" ON b2b_payments FOR ALL
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin'));
