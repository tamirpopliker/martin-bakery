-- ============================================================
-- מנגנון הזמנות פנימיות — מפעל ↔ סניפים
-- הרץ את הסקריפט ב-Supabase SQL Editor
-- ============================================================

-- 1. הוספת עמודות לטבלת factory_sales
ALTER TABLE factory_sales
  ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS target_branch_id INTEGER,
  ADD COLUMN IF NOT EXISTS branch_status TEXT DEFAULT 'pending'
    CHECK (branch_status IN ('pending', 'approved', 'disputed'));

-- 2. הוספת עמודות לטבלת factory_b2b_sales
ALTER TABLE factory_b2b_sales
  ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS target_branch_id INTEGER,
  ADD COLUMN IF NOT EXISTS branch_status TEXT DEFAULT 'pending'
    CHECK (branch_status IN ('pending', 'approved', 'disputed'));

-- 3. טבלת מיפוי לקוח פנימי → סניף
CREATE TABLE IF NOT EXISTS internal_customer_map (
  id SERIAL PRIMARY KEY,
  customer_pattern TEXT NOT NULL UNIQUE,
  branch_id INTEGER NOT NULL,
  active BOOLEAN DEFAULT true
);

INSERT INTO internal_customer_map (customer_pattern, branch_id) VALUES
  ('מרטין- אברהם אבינו', 1),
  ('מרטין - עמק שרה', 2),
  ('מרטין - יעקב כהן', 3)
ON CONFLICT (customer_pattern) DO NOTHING;

-- 4. סימון רטרואקטיבי של מכירות קיימות
UPDATE factory_sales fs
SET is_internal = true,
    target_branch_id = m.branch_id,
    branch_status = 'approved'
FROM internal_customer_map m
WHERE fs.customer = m.customer_pattern;

UPDATE factory_b2b_sales fbs
SET is_internal = true,
    target_branch_id = m.branch_id,
    branch_status = 'approved'
FROM internal_customer_map m
WHERE fbs.customer = m.customer_pattern;

-- 5. אינדקסים לשאילתות מהירות
CREATE INDEX IF NOT EXISTS idx_factory_sales_internal
  ON factory_sales (is_internal);
CREATE INDEX IF NOT EXISTS idx_factory_sales_target_branch
  ON factory_sales (target_branch_id);
CREATE INDEX IF NOT EXISTS idx_factory_b2b_sales_internal
  ON factory_b2b_sales (is_internal);
CREATE INDEX IF NOT EXISTS idx_factory_b2b_sales_target_branch
  ON factory_b2b_sales (target_branch_id);
