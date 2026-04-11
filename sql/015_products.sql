-- Product catalog with price tracking
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  product_name TEXT UNIQUE NOT NULL,
  department TEXT,
  current_price NUMERIC NOT NULL DEFAULT 0,
  last_price NUMERIC,
  price_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_factory_manage_products" ON products FOR ALL
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role IN ('admin', 'factory')));
