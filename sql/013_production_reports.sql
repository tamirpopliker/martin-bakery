-- Production reports table for consolidated Excel uploads
CREATE TABLE IF NOT EXISTS production_reports (
  id SERIAL PRIMARY KEY,
  report_date DATE NOT NULL,
  product_name TEXT NOT NULL,
  department TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE production_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin and factory can manage production_reports"
  ON production_reports FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE auth_uid = auth.uid()
        AND role IN ('admin', 'factory')
    )
  );
