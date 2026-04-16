-- Cash register management module
-- Tables: register_closings, change_fund

CREATE TABLE IF NOT EXISTS register_closings (
  id SERIAL PRIMARY KEY,
  branch_id INT NOT NULL,
  date DATE NOT NULL,
  register_number INT NOT NULL,
  opening_balance NUMERIC NOT NULL DEFAULT 0,
  cash_sales NUMERIC NOT NULL DEFAULT 0,
  credit_sales NUMERIC NOT NULL DEFAULT 0,
  transaction_count INT DEFAULT 0,
  actual_cash NUMERIC NOT NULL DEFAULT 0,
  deposit_amount NUMERIC NOT NULL DEFAULT 0,
  variance NUMERIC NOT NULL DEFAULT 0,
  variance_action TEXT CHECK (variance_action IN ('surplus_fund','documented','kept')),
  next_opening_balance NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_register_closings_branch_date
  ON register_closings (branch_id, date);

CREATE INDEX IF NOT EXISTS idx_register_closings_register_date
  ON register_closings (branch_id, register_number, date);

CREATE TABLE IF NOT EXISTS change_fund (
  id SERIAL PRIMARY KEY,
  branch_id INT NOT NULL,
  date DATE NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'income','expense','reset',
    'auto_from_closing','withdraw_to_register','push_from_register'
  )),
  amount NUMERIC NOT NULL,
  description TEXT,
  balance_after NUMERIC NOT NULL DEFAULT 0,
  related_closing_id INT REFERENCES register_closings(id) ON DELETE SET NULL,
  related_register_number INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_change_fund_branch_date
  ON change_fund (branch_id, date);

-- RLS
ALTER TABLE register_closings ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_fund ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "manage_register_closings" ON register_closings;
CREATE POLICY "manage_register_closings" ON register_closings FOR ALL
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role IN ('admin','branch')));

DROP POLICY IF EXISTS "manage_change_fund" ON change_fund;
CREATE POLICY "manage_change_fund" ON change_fund FOR ALL
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role IN ('admin','branch')));

-- Optional base fund setting per branch — stored in system_settings with key pattern 'change_fund_base_{branch_id}'

-- Migration idempotency helper (safe to re-run)
ALTER TABLE register_closings ADD COLUMN IF NOT EXISTS transaction_count INT DEFAULT 0;
