-- Special cake orders module
CREATE TABLE IF NOT EXISTS special_orders (
  id SERIAL PRIMARY KEY,
  order_number TEXT UNIQUE NOT NULL,
  branch_id INT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  pickup_date DATE NOT NULL,
  pickup_time TEXT,
  type TEXT NOT NULL CHECK (type IN ('חלבי','פרווה')),
  base_size TEXT NOT NULL,
  torte_flavor TEXT NOT NULL,
  cream_between TEXT NOT NULL,
  filling TEXT NOT NULL,
  coating TEXT NOT NULL,
  crown TEXT NOT NULL,
  extras TEXT[],
  dedication TEXT,
  image_requested BOOLEAN DEFAULT false,
  advance_payment NUMERIC DEFAULT 0,
  notes TEXT,
  factory_notes TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','confirmed','in_production','ready','delivered','cancelled')),
  created_by UUID REFERENCES app_users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_notifications (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES app_users(id),
  order_id INT REFERENCES special_orders(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE special_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "manage_special_orders" ON special_orders;
CREATE POLICY "manage_special_orders" ON special_orders FOR ALL
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role IN ('admin','branch','factory')));
DROP POLICY IF EXISTS "manage_order_notifications" ON order_notifications;
CREATE POLICY "manage_order_notifications" ON order_notifications FOR ALL
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid()));
