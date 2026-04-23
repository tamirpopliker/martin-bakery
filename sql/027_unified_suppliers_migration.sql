-- Migration 027: Unified suppliers table
-- Creates a single canonical suppliers table with scope column.
-- Does NOT delete old tables (suppliers, branch_suppliers, unified_suppliers) — those are handled in a later phase.
-- Does NOT touch application code — only data.

BEGIN;

-- 1. יצירת הטבלה החדשה
CREATE TABLE IF NOT EXISTS suppliers_new (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  scope      TEXT NOT NULL CHECK (scope IN ('factory', 'branch', 'shared')),
  branch_id  INT NULL REFERENCES branches(id),
  category   TEXT NULL,
  contact    TEXT NULL,
  phone      TEXT NULL,
  notes      TEXT NULL,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- ספק עם scope='branch' חייב branch_id. ספקים אחרים לא.
  CONSTRAINT branch_scope_requires_branch_id
    CHECK ((scope = 'branch' AND branch_id IS NOT NULL) OR (scope <> 'branch' AND branch_id IS NULL)),

  -- אין כפילות של אותו שם באותו scope+branch
  CONSTRAINT unique_supplier_per_scope
    UNIQUE (name, scope, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_suppliers_new_scope ON suppliers_new(scope);
CREATE INDEX IF NOT EXISTS idx_suppliers_new_branch ON suppliers_new(branch_id) WHERE branch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_suppliers_new_name_lower ON suppliers_new(LOWER(TRIM(name)));

-- 2. הכנסת ספקי מפעל — עם סימון מיוחד לאלה שמשותפים
-- 3 הספקים המשותפים (אופיס 2000, עולם הכלים, תבליני פארן) ייכנסו כ-shared
-- השאר ייכנסו כ-factory

INSERT INTO suppliers_new (name, scope, created_at)
SELECT
  TRIM(name),
  CASE
    WHEN LOWER(TRIM(name)) IN ('אופיס 2000', 'עולם הכלים', 'תבליני פארן') THEN 'shared'
    ELSE 'factory'
  END AS scope,
  created_at
FROM suppliers
ON CONFLICT (name, scope, branch_id) DO NOTHING;

-- 3. הכנסת ספקי סניפים, עם איחוד של כפילויות ידועות
-- כפילויות ידועות בין סניפים (רשומות פעמיים): לחם הבלקן, הפנתר הורוד, ליאם אריזות, בית הבגט, מפעל ייצור
-- אלה ייכנסו כ-shared (משותפים בין סניפים), רשומה אחת בלבד.
-- "ליאם אריזות" ו-"ליאם אריזות בע"מ" יאוחדו תחת "ליאם אריזות בע"מ" (הגרסה הארוכה).
-- "מונייר" יאוחד עם "מונייר פוד דיזיין" תחת "מונייר פוד דיזיין".
-- "מפעל ייצור" — legacy, לא מעבירים. נשאר בטבלה הישנה.

WITH supplier_aliases AS (
  -- מנרמל את השם כדי לזהות כפילויות
  SELECT
    id,
    name AS original_name,
    branch_id,
    CASE
      WHEN LOWER(TRIM(name)) = 'ליאם אריזות' THEN 'ליאם אריזות בע"מ'
      WHEN LOWER(TRIM(name)) = 'מונייר' THEN 'מונייר פוד דיזיין'
      ELSE TRIM(name)
    END AS canonical_name,
    contact, phone, category, notes, active, created_at
  FROM branch_suppliers
  WHERE LOWER(TRIM(name)) != 'מפעל ייצור'  -- legacy, מדלגים
),
classified AS (
  SELECT
    canonical_name,
    branch_id,
    -- ספק משותף אם יש לו הופעה באותו שם ביותר מסניף אחד
    CASE
      WHEN COUNT(*) OVER (PARTITION BY LOWER(canonical_name)) > 1 THEN 'shared'
      ELSE 'branch'
    END AS supplier_scope,
    -- מידע תצוגתי — לוקחים מהרשומה הראשונה (מינ' id)
    FIRST_VALUE(contact) OVER (PARTITION BY LOWER(canonical_name) ORDER BY id) AS contact,
    FIRST_VALUE(phone)   OVER (PARTITION BY LOWER(canonical_name) ORDER BY id) AS phone,
    FIRST_VALUE(category) OVER (PARTITION BY LOWER(canonical_name) ORDER BY id) AS category,
    FIRST_VALUE(notes)   OVER (PARTITION BY LOWER(canonical_name) ORDER BY id) AS notes,
    FIRST_VALUE(active)  OVER (PARTITION BY LOWER(canonical_name) ORDER BY id) AS active,
    FIRST_VALUE(created_at) OVER (PARTITION BY LOWER(canonical_name) ORDER BY id) AS created_at,
    ROW_NUMBER() OVER (PARTITION BY LOWER(canonical_name) ORDER BY id) AS rn
  FROM supplier_aliases
)
INSERT INTO suppliers_new (name, scope, branch_id, contact, phone, category, notes, active, created_at)
SELECT
  canonical_name,
  supplier_scope,
  CASE WHEN supplier_scope = 'shared' THEN NULL ELSE branch_id END,
  contact, phone, category, notes, active, created_at
FROM classified
WHERE rn = 1  -- רק הרשומה הראשונה לכל שם מנורמל
ON CONFLICT (name, scope, branch_id) DO NOTHING;

-- 4. בדיקת שפיות — ספירה מול הצפוי
DO $$
DECLARE
  total_count INT;
  factory_count INT;
  branch_count INT;
  shared_count INT;
  names_sample TEXT;
BEGIN
  SELECT COUNT(*) INTO total_count FROM suppliers_new;
  SELECT COUNT(*) INTO factory_count FROM suppliers_new WHERE scope = 'factory';
  SELECT COUNT(*) INTO branch_count FROM suppliers_new WHERE scope = 'branch';
  SELECT COUNT(*) INTO shared_count FROM suppliers_new WHERE scope = 'shared';

  SELECT string_agg(name, ', ' ORDER BY name) INTO names_sample
  FROM suppliers_new WHERE scope = 'shared';

  RAISE NOTICE 'Migration 027 summary:';
  RAISE NOTICE '  Total suppliers: %', total_count;
  RAISE NOTICE '  factory scope: %', factory_count;
  RAISE NOTICE '  branch scope:  %', branch_count;
  RAISE NOTICE '  shared scope:  % (%)', shared_count, names_sample;
  RAISE NOTICE '  Source totals: suppliers=26, branch_suppliers=27 (minus legacy).';
  RAISE NOTICE '  Expected shared: ~8 (3 from factory+branch overlap, 4-5 from branch+branch duplicates).';
END $$;

-- 5. RLS policies על הטבלה החדשה
ALTER TABLE suppliers_new ENABLE ROW LEVEL SECURITY;

-- admin: הכל
CREATE POLICY "admin_all_suppliers_new" ON suppliers_new
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin')
  );

-- factory: רואה factory + shared
CREATE POLICY "factory_read_suppliers_new" ON suppliers_new
  FOR SELECT TO authenticated
  USING (
    scope IN ('factory', 'shared')
    AND EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'factory')
  );

-- branch: רואה shared + branch שלו
CREATE POLICY "branch_read_suppliers_new" ON suppliers_new
  FOR SELECT TO authenticated
  USING (
    scope = 'shared'
    OR (scope = 'branch' AND branch_id = (
      SELECT branch_id FROM app_users WHERE auth_uid = auth.uid() AND role = 'branch' LIMIT 1
    ))
  );

COMMIT;
