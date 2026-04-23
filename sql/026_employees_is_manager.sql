-- ═══════════════════════════════════════════════════════════════════════════
-- 026: Mark factory department managers in `employees`
-- ═══════════════════════════════════════════════════════════════════════════
-- רציונל: מאפשר הסתרת שכר המנהלים (תמיר/נאור) מכל משתמש שאינו admin
--          בתצוגות הדף "לייבור מפעל" ובשאר הדשבורדים שמשתמשים ב-employees.
--
-- הקוד של Labor.tsx מכיל fallback לזיהוי לפי שם (MANAGER_NAMES_FALLBACK),
-- כך שההסתרה פועלת גם לפני הרצת המיגרציה. המיגרציה רק הופכת את ההסתרה
-- למדויקת ובלתי-תלויה באיות השם.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_manager BOOLEAN DEFAULT FALSE;

-- סימון מנהלי המחלקות הידועים
UPDATE employees SET is_manager = TRUE
WHERE name IN ('נאור אורן', 'אורן נאור', 'תמיר רוזנברג', 'רוזנברג תמיר');

-- אינדקס חלקי — הרוב המוחלט של השורות הוא is_manager=FALSE
CREATE INDEX IF NOT EXISTS idx_employees_is_manager
  ON employees(is_manager) WHERE is_manager = TRUE;

-- דיווח
DO $$
DECLARE
  manager_count INT;
  manager_names TEXT;
BEGIN
  SELECT COUNT(*), string_agg(name, ', ')
    INTO manager_count, manager_names
    FROM employees WHERE is_manager = TRUE;
  RAISE NOTICE 'Migration complete: % managers marked (%)', manager_count, manager_names;
END $$;
