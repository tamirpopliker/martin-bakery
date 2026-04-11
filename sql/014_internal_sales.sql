-- Internal sales workflow: factory → branch
CREATE TABLE IF NOT EXISTS internal_sales (
  id SERIAL PRIMARY KEY,
  order_number TEXT,
  order_date DATE NOT NULL,
  branch_id INT NOT NULL,
  department TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'modified', 'completed')),
  total_amount NUMERIC NOT NULL DEFAULT 0,
  uploaded_by TEXT,
  confirmed_by TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS internal_sale_items (
  id SERIAL PRIMARY KEY,
  sale_id INT NOT NULL REFERENCES internal_sales(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  department TEXT,
  quantity_supplied NUMERIC NOT NULL DEFAULT 0,
  quantity_confirmed NUMERIC,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  total_price NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_department_mapping (
  id SERIAL PRIMARY KEY,
  product_name TEXT UNIQUE NOT NULL,
  department TEXT NOT NULL
);

ALTER TABLE internal_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_department_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_factory_branch_manage_internal_sales" ON internal_sales FOR ALL
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role IN ('admin', 'factory', 'branch')));

CREATE POLICY "admin_factory_branch_manage_internal_sale_items" ON internal_sale_items FOR ALL
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role IN ('admin', 'factory', 'branch')));

CREATE POLICY "admin_factory_manage_product_dept_mapping" ON product_department_mapping FOR ALL
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role IN ('admin', 'factory')));
