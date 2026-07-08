-- ═══════════════════════════════════════════════════════════════════════════
-- 069: employer_cost_matches — זיכרון התאמות עובדים בדוח מעסיק בין חודשים
-- ═══════════════════════════════════════════════════════════════════════════
-- תאריך:  2026-07-08
-- רקע:    בהעלאת "דוח מעסיק" המערכת מתאימה כל שורה לעובד. עובדי סניף כבר
--         נזכרים (payroll_number על branch_employees), אבל עובדי מפעל מותאמים
--         לפי דמיון-שם בלבד וללא זיכרון — ולכן המשתמש משייך אותם מחדש כל חודש.
--         טבלה זו שומרת את ההתאמה שאושרה, לפי המפתח היציב employee_number (מספר
--         השכר מהאקסל), כך שבחודש הבא כל השורות המוכרות מתמלאות אוטומטית.
--         דפוס זהה ל-product_department_mapping (מיפוי ידני שנשמר).
--
-- admin בלבד — כמו employer_costs (020).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS employer_cost_matches (
  employee_number     INT PRIMARY KEY,        -- מספר שכר יציב מהדוח
  employee_name       TEXT,                   -- לתצוגה/ביקורת (עשוי להשתנות בכתיב)
  matched_employee_id INT,                    -- branch_employees.id (NULL למפעל/לא-פעיל)
  branch_id           INT,
  is_headquarters     BOOLEAN DEFAULT FALSE,
  is_manager          BOOLEAN DEFAULT FALSE,
  assignment          TEXT,                   -- תווית מיקום/מחלקה שנבחרה
  updated_at          TIMESTAMPTZ DEFAULT now(),
  updated_by          TEXT
);

ALTER TABLE employer_cost_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_manage_employer_cost_matches" ON employer_cost_matches;
CREATE POLICY "admin_manage_employer_cost_matches" ON employer_cost_matches FOR ALL
  USING      (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin'));

-- ─── אתחול מההיסטוריה ────────────────────────────────────────────────────
-- זריעה מהחודש האחרון שבו כל עובד הופיע ב-employer_costs, כדי שההעלאה הבאה
-- כבר תזהה אוטומטית את כל מי שהופיע אי-פעם (מפעל + מטה + סניף). matched_employee_id
-- נשאר NULL (employer_costs לא שומר אותו) — עובדי סניף ימשיכו להתאים לפי
-- payroll_number, וה-overlay לא ידרוס קישור קיים.
INSERT INTO employer_cost_matches
  (employee_number, employee_name, matched_employee_id, branch_id, is_headquarters, is_manager, assignment, updated_by)
SELECT DISTINCT ON (ec.employee_number)
  ec.employee_number, ec.employee_name, NULL::int,
  ec.branch_id, ec.is_headquarters, ec.is_manager, ec.department_name, 'seed:history'
FROM employer_costs ec
WHERE ec.employee_number IS NOT NULL
ORDER BY ec.employee_number, ec.year DESC, ec.month DESC
ON CONFLICT (employee_number) DO NOTHING;
