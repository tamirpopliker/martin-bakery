-- ═══════════════════════════════════════════════════════════════════════════
-- 025: RLS קריטי — שלב 1 (§4.1 + §4.3 של rls_migration_plan.md)
-- ═══════════════════════════════════════════════════════════════════════════
-- תאריך:          2026-04-21
-- מקור:           sql/rls_migration_plan.md  (שלב 1 מתוך 4)
-- תוצר:           RLS + policies על 18 טבלאות חיוניות
-- ═══════════════════════════════════════════════════════════════════════════
--
-- §4.1 — טבלאות פיננסיות ללא RLS קיים
--   §4.1.1  branch_revenue, branch_expenses, branch_labor, branch_waste
--   §4.1.2  fixed_costs                   (סינון לפי entity_type — לא entity_id)
--   §4.1.3  employees                     (סינון factory לפי managed_department)
--   §4.1.4  factory_sales, factory_b2b_sales  (branch רואה רק is_internal שלו)
--   §4.1.5  suppliers, supplier_invoices, unified_suppliers,
--           branch_suppliers, branch_credit_customers
--
-- §4.3 — חידוד policies רופפות קיימות
--   §4.3.1  branch_kpi_targets            (להסיר FOR ALL authenticated)
--   §4.3.2  system_settings               (חזרה למצב של 008 — WRITE רק admin)
--   §4.3.3  branch_employees              (WRITE מסונן; SELECT פתוח interim)
--   §4.3.4  branch_messages, message_reads (תיקון 'employee' + סינון branch_id)
--
-- תיקונים שהתבצעו מול התוכנית המקורית:
--   - fixed_costs: entity_type (לא entity_id כפי שהונח בתוכנית המקורית)
--   - employees/factory: סינון managed_department עם NULL כ-fallback (רואה הכל)
--   - branch_messages: employee נשען על app_users.branch_id (שנקבע ב-008_auth_trigger),
--                       לא join ל-branch_employees
--   - branch_employees: SELECT נשאר פתוח (hourly_rate/retention_bonus חשופים).
--                       שלב 2 — VIEW branch_employees_safe + הידוק SELECT.
--
-- אידמפוטנטי — ניתן להריץ שוב ושוב בלי שגיאה.
-- עטוף בטרנזקציה אחת — אם משהו נכשל, הכל מתגלגל לאחור.
-- כל FOR ALL כולל WITH CHECK כדי למנוע UPDATE שמעביר שורה בין סניפים.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- §4.1.1 — טבלאות הכנסה/הוצאה/שכר/פסולת של סניפים
--          admin: הכל | branch: רק הסניף שלו | factory: אין גישה
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE branch_revenue  ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_labor    ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_waste    ENABLE ROW LEVEL SECURITY;

-- branch_revenue — הכנסות יומיות
DROP POLICY IF EXISTS "branch_own_revenue" ON branch_revenue;
CREATE POLICY "branch_own_revenue" ON branch_revenue FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (u.role = 'admin'
             OR (u.role = 'branch' AND u.branch_id = branch_revenue.branch_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (u.role = 'admin'
             OR (u.role = 'branch' AND u.branch_id = branch_revenue.branch_id))
    )
  );

-- branch_expenses — הוצאות יומיות
DROP POLICY IF EXISTS "branch_own_expenses" ON branch_expenses;
CREATE POLICY "branch_own_expenses" ON branch_expenses FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (u.role = 'admin'
             OR (u.role = 'branch' AND u.branch_id = branch_expenses.branch_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (u.role = 'admin'
             OR (u.role = 'branch' AND u.branch_id = branch_expenses.branch_id))
    )
  );

-- branch_labor — שכר עובדי סניף
DROP POLICY IF EXISTS "branch_own_labor" ON branch_labor;
CREATE POLICY "branch_own_labor" ON branch_labor FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (u.role = 'admin'
             OR (u.role = 'branch' AND u.branch_id = branch_labor.branch_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (u.role = 'admin'
             OR (u.role = 'branch' AND u.branch_id = branch_labor.branch_id))
    )
  );

-- branch_waste — פסולת סניף
DROP POLICY IF EXISTS "branch_own_waste" ON branch_waste;
CREATE POLICY "branch_own_waste" ON branch_waste FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (u.role = 'admin'
             OR (u.role = 'branch' AND u.branch_id = branch_waste.branch_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (u.role = 'admin'
             OR (u.role = 'branch' AND u.branch_id = branch_waste.branch_id))
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- §4.1.2 — fixed_costs
--          admin: הכל
--          factory: entity_type = 'factory'
--          branch:  entity_type = 'branch_' || u.branch_id
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE fixed_costs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fixed_costs_scoped" ON fixed_costs;
CREATE POLICY "fixed_costs_scoped" ON fixed_costs FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (
          u.role = 'admin'
          OR (u.role = 'factory' AND fixed_costs.entity_type = 'factory')
          OR (u.role = 'branch'
              AND fixed_costs.entity_type = 'branch_' || u.branch_id::text)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (
          u.role = 'admin'
          OR (u.role = 'factory' AND fixed_costs.entity_type = 'factory')
          OR (u.role = 'branch'
              AND fixed_costs.entity_type = 'branch_' || u.branch_id::text)
        )
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- §4.1.3 — employees
--          admin: הכל
--          factory: רק מחלקות מפעל, ואם managed_department מוגדר — רק הוא
--          branch: אין גישה
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "employees_scoped" ON employees;
CREATE POLICY "employees_scoped" ON employees FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (
          u.role = 'admin'
          OR (
            u.role = 'factory'
            AND employees.department IN ('creams','dough','packaging','cleaning')
            AND (u.managed_department IS NULL
                 OR u.managed_department = employees.department)
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (
          u.role = 'admin'
          OR (
            u.role = 'factory'
            AND employees.department IN ('creams','dough','packaging','cleaning')
            AND (u.managed_department IS NULL
                 OR u.managed_department = employees.department)
          )
        )
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- §4.1.4 — factory_sales, factory_b2b_sales
--          admin + factory: הכל
--          branch: רק is_internal=true AND target_branch_id = u.branch_id
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE factory_sales     ENABLE ROW LEVEL SECURITY;
ALTER TABLE factory_b2b_sales ENABLE ROW LEVEL SECURITY;

-- factory_sales — מכירות מפעל (כולל מכירות פנימיות לסניפים)
DROP POLICY IF EXISTS "factory_sales_access" ON factory_sales;
CREATE POLICY "factory_sales_access" ON factory_sales FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (
          u.role = 'admin'
          OR u.role = 'factory'
          OR (u.role = 'branch'
              AND factory_sales.is_internal = true
              AND factory_sales.target_branch_id = u.branch_id)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (
          u.role = 'admin'
          OR u.role = 'factory'
          OR (u.role = 'branch'
              AND factory_sales.is_internal = true
              AND factory_sales.target_branch_id = u.branch_id)
        )
    )
  );

-- factory_b2b_sales — מכירות B2B של המפעל
DROP POLICY IF EXISTS "factory_b2b_sales_access" ON factory_b2b_sales;
CREATE POLICY "factory_b2b_sales_access" ON factory_b2b_sales FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (
          u.role = 'admin'
          OR u.role = 'factory'
          OR (u.role = 'branch'
              AND factory_b2b_sales.is_internal = true
              AND factory_b2b_sales.target_branch_id = u.branch_id)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (
          u.role = 'admin'
          OR u.role = 'factory'
          OR (u.role = 'branch'
              AND factory_b2b_sales.is_internal = true
              AND factory_b2b_sales.target_branch_id = u.branch_id)
        )
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- §4.1.5 — suppliers, supplier_invoices, unified_suppliers, branch_suppliers, branch_credit_customers
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE suppliers                ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_invoices        ENABLE ROW LEVEL SECURITY;
ALTER TABLE unified_suppliers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_suppliers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_credit_customers  ENABLE ROW LEVEL SECURITY;

-- suppliers — ספקי המפעל: admin + factory
DROP POLICY IF EXISTS "suppliers_access" ON suppliers;
CREATE POLICY "suppliers_access" ON suppliers FOR ALL
  USING (
    EXISTS (SELECT 1 FROM app_users
            WHERE auth_uid = auth.uid() AND role IN ('admin','factory'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM app_users
            WHERE auth_uid = auth.uid() AND role IN ('admin','factory'))
  );

-- supplier_invoices — חשבוניות ספקים: admin + factory
DROP POLICY IF EXISTS "supplier_invoices_access" ON supplier_invoices;
CREATE POLICY "supplier_invoices_access" ON supplier_invoices FOR ALL
  USING (
    EXISTS (SELECT 1 FROM app_users
            WHERE auth_uid = auth.uid() AND role IN ('admin','factory'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM app_users
            WHERE auth_uid = auth.uid() AND role IN ('admin','factory'))
  );

-- unified_suppliers — דוח ניהולי: admin בלבד
DROP POLICY IF EXISTS "unified_suppliers_access" ON unified_suppliers;
CREATE POLICY "unified_suppliers_access" ON unified_suppliers FOR ALL
  USING (
    EXISTS (SELECT 1 FROM app_users
            WHERE auth_uid = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM app_users
            WHERE auth_uid = auth.uid() AND role = 'admin')
  );

-- branch_suppliers — ספקי סניף: admin + branch-own
DROP POLICY IF EXISTS "branch_suppliers_access" ON branch_suppliers;
CREATE POLICY "branch_suppliers_access" ON branch_suppliers FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (u.role = 'admin'
             OR (u.role = 'branch' AND u.branch_id = branch_suppliers.branch_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (u.role = 'admin'
             OR (u.role = 'branch' AND u.branch_id = branch_suppliers.branch_id))
    )
  );

-- branch_credit_customers — לקוחות אשראי של סניף: admin + branch-own
DROP POLICY IF EXISTS "branch_credit_customers_access" ON branch_credit_customers;
CREATE POLICY "branch_credit_customers_access" ON branch_credit_customers FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (u.role = 'admin'
             OR (u.role = 'branch' AND u.branch_id = branch_credit_customers.branch_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (u.role = 'admin'
             OR (u.role = 'branch' AND u.branch_id = branch_credit_customers.branch_id))
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- §4.3.1 — branch_kpi_targets
--          הסרת 4 ה-policies הרופפות של 011, החלפה בסינון branch_id
-- ═══════════════════════════════════════════════════════════════════════════

-- בטחוני: RLS אמור כבר להיות מופעל מ-011, אבל idempotent
ALTER TABLE branch_kpi_targets ENABLE ROW LEVEL SECURITY;

-- הסרת 4 ה-policies הרופפות שנוצרו ב-011_fix_branch_kpi_rls.sql
DROP POLICY IF EXISTS "Allow authenticated select" ON branch_kpi_targets;
DROP POLICY IF EXISTS "Allow authenticated insert" ON branch_kpi_targets;
DROP POLICY IF EXISTS "Allow authenticated update" ON branch_kpi_targets;
DROP POLICY IF EXISTS "Allow authenticated delete" ON branch_kpi_targets;

-- Policy מקושר: admin + branch-own
DROP POLICY IF EXISTS "branch_kpi_targets_scoped" ON branch_kpi_targets;
CREATE POLICY "branch_kpi_targets_scoped" ON branch_kpi_targets FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (u.role = 'admin'
             OR (u.role = 'branch' AND u.branch_id = branch_kpi_targets.branch_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (u.role = 'admin'
             OR (u.role = 'branch' AND u.branch_id = branch_kpi_targets.branch_id))
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- §4.3.2 — system_settings
--          הסרת policies הרופפות של 012, חזרה למצב של 008:
--          SELECT פתוח לכולם, WRITE רק admin
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

-- הסרת policies הרופפות של 012 (authenticated select/update/insert)
DROP POLICY IF EXISTS "Allow authenticated select" ON system_settings;
DROP POLICY IF EXISTS "Allow authenticated update" ON system_settings;
DROP POLICY IF EXISTS "Allow authenticated insert" ON system_settings;

-- בנוסף — גם הפוליסי של 008 אם קיימת, כדי לאפשר re-run idempotent
DROP POLICY IF EXISTS "Everyone can read system_settings" ON system_settings;
DROP POLICY IF EXISTS "Admins can manage system_settings" ON system_settings;

-- יצירה מחדש: SELECT פתוח, WRITE רק admin
CREATE POLICY "Everyone can read system_settings" ON system_settings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage system_settings" ON system_settings
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin')
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- §4.3.3 — branch_employees
--
-- NOTE: SELECT נשאר פתוח לכל authenticated. עמודות שכר
-- (hourly_rate, retention_bonus) חשופות לעובדים — זה המצב היום
-- ולא מידרדר. בשלב 2 ניצור VIEW branch_employees_safe בלי
-- עמודות שכר ונחליף את branch_employees_select_all.
-- כאן מתקנים רק את הבאג הקריטי של כתיבה צולבת בין סניפים.
--
-- ההיגיון של שני policies בו-זמנית:
-- PostgreSQL משלב מרובי policies ב-OR. עבור SELECT, הפוליסי הראשון
-- מחזיר true (פתוח) → השני לא מוריד הרשאה. עבור INSERT/UPDATE/DELETE,
-- רק הפוליסי השני חל (הראשון הוא FOR SELECT בלבד ולא חל על כתיבה)
-- → מסונן ל-admin + branch-own.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE branch_employees ENABLE ROW LEVEL SECURITY;

-- SELECT: פתוח (interim — עד שלב 2)
DROP POLICY IF EXISTS "Everyone can read branch_employees" ON branch_employees;
DROP POLICY IF EXISTS "branch_employees_select_all" ON branch_employees;
CREATE POLICY "branch_employees_select_all" ON branch_employees
  FOR SELECT TO authenticated USING (true);

-- WRITE: admin + branch-own בלבד (הבאג הקריטי מתוקן כאן)
DROP POLICY IF EXISTS "Admins can manage branch_employees" ON branch_employees;
DROP POLICY IF EXISTS "branch_employees_scoped" ON branch_employees;
DROP POLICY IF EXISTS "branch_employees_write_scoped" ON branch_employees;
CREATE POLICY "branch_employees_write_scoped" ON branch_employees
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (u.role = 'admin'
             OR (u.role = 'branch' AND u.branch_id = branch_employees.branch_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (u.role = 'admin'
             OR (u.role = 'branch' AND u.branch_id = branch_employees.branch_id))
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- §4.3.4 — branch_messages, message_reads
--          employee נשען על app_users.branch_id (שנקבע ב-008_auth_trigger):
--          כל employee חדש מקבל branch_id של ה-branch_employee שלו.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE branch_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reads   ENABLE ROW LEVEL SECURITY;

-- הסרת policies ישנות של 018 (שכללו 'employee' בלי branch_id, ולכן היו רופפות)
DROP POLICY IF EXISTS "branch_manage_messages" ON branch_messages;
DROP POLICY IF EXISTS "branch_manage_reads"    ON message_reads;

-- branch_messages — admin + branch + employee (דרך branch_id של app_users)
DROP POLICY IF EXISTS "branch_messages_scoped" ON branch_messages;
CREATE POLICY "branch_messages_scoped" ON branch_messages FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (
          u.role = 'admin'
          OR (u.role IN ('branch','employee')
              AND u.branch_id = branch_messages.branch_id)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (
          u.role = 'admin'
          OR (u.role IN ('branch','employee')
              AND u.branch_id = branch_messages.branch_id)
        )
    )
  );

-- message_reads — רשומות קריאה של עובד. הצצה דרך branch_employees.branch_id
DROP POLICY IF EXISTS "message_reads_scoped" ON message_reads;
CREATE POLICY "message_reads_scoped" ON message_reads FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (
          u.role = 'admin'
          OR (u.role IN ('branch','employee') AND EXISTS (
                SELECT 1 FROM branch_employees be
                WHERE be.id = message_reads.employee_id
                  AND be.branch_id = u.branch_id
              ))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (
          u.role = 'admin'
          OR (u.role IN ('branch','employee') AND EXISTS (
                SELECT 1 FROM branch_employees be
                WHERE be.id = message_reads.employee_id
                  AND be.branch_id = u.branch_id
              ))
        )
    )
  );

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- סוף שלב 1. שלבים 2-4 יתבצעו במיגרציות נפרדות.
-- ═══════════════════════════════════════════════════════════════════════════


/*
═══════════════════════════════════════════════════════════════════════════
ROLLBACK — הרץ ידנית רק במקרה חירום
═══════════════════════════════════════════════════════════════════════════
BEGIN;

-- השבתת RLS על כל הטבלאות שהופעלו כאן:
ALTER TABLE branch_revenue       DISABLE ROW LEVEL SECURITY;
ALTER TABLE branch_expenses      DISABLE ROW LEVEL SECURITY;
ALTER TABLE branch_labor         DISABLE ROW LEVEL SECURITY;
ALTER TABLE branch_waste         DISABLE ROW LEVEL SECURITY;
ALTER TABLE fixed_costs          DISABLE ROW LEVEL SECURITY;
ALTER TABLE employees            DISABLE ROW LEVEL SECURITY;
ALTER TABLE factory_sales        DISABLE ROW LEVEL SECURITY;
ALTER TABLE factory_b2b_sales    DISABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers            DISABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_invoices    DISABLE ROW LEVEL SECURITY;
ALTER TABLE unified_suppliers    DISABLE ROW LEVEL SECURITY;
ALTER TABLE branch_suppliers     DISABLE ROW LEVEL SECURITY;
ALTER TABLE branch_credit_customers DISABLE ROW LEVEL SECURITY;
-- branch_kpi_targets, system_settings, branch_employees, branch_messages,
-- message_reads — היה להן RLS מראש; אל תבטל אלא אם אתה מבין את ההשלכה.

-- הסרת ה-policies החדשות:
DROP POLICY IF EXISTS "branch_own_revenue"         ON branch_revenue;
DROP POLICY IF EXISTS "branch_own_expenses"        ON branch_expenses;
DROP POLICY IF EXISTS "branch_own_labor"           ON branch_labor;
DROP POLICY IF EXISTS "branch_own_waste"           ON branch_waste;
DROP POLICY IF EXISTS "fixed_costs_scoped"         ON fixed_costs;
DROP POLICY IF EXISTS "employees_scoped"           ON employees;
DROP POLICY IF EXISTS "factory_sales_access"       ON factory_sales;
DROP POLICY IF EXISTS "factory_b2b_sales_access"   ON factory_b2b_sales;
DROP POLICY IF EXISTS "suppliers_access"           ON suppliers;
DROP POLICY IF EXISTS "supplier_invoices_access"   ON supplier_invoices;
DROP POLICY IF EXISTS "unified_suppliers_access"   ON unified_suppliers;
DROP POLICY IF EXISTS "branch_suppliers_access"    ON branch_suppliers;
DROP POLICY IF EXISTS "branch_credit_customers_access" ON branch_credit_customers;
DROP POLICY IF EXISTS "branch_kpi_targets_scoped"       ON branch_kpi_targets;
DROP POLICY IF EXISTS "branch_employees_select_all"     ON branch_employees;
DROP POLICY IF EXISTS "branch_employees_write_scoped"   ON branch_employees;
DROP POLICY IF EXISTS "branch_messages_scoped"          ON branch_messages;
DROP POLICY IF EXISTS "message_reads_scoped"            ON message_reads;

-- שחזור policies רופפות קודמות של system_settings (רק אם באמת צריך, למשל
-- כי פונקציה שדורשת UPDATE נשברה):
-- CREATE POLICY "Allow authenticated select" ON system_settings
--   FOR SELECT TO authenticated USING (true);
-- CREATE POLICY "Allow authenticated update" ON system_settings
--   FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
-- CREATE POLICY "Allow authenticated insert" ON system_settings
--   FOR INSERT TO authenticated WITH CHECK (true);

-- שחזור policies של branch_kpi_targets (מצב 011):
-- CREATE POLICY "Allow authenticated select" ON branch_kpi_targets
--   FOR SELECT TO authenticated USING (true);
-- CREATE POLICY "Allow authenticated insert" ON branch_kpi_targets
--   FOR INSERT TO authenticated WITH CHECK (true);
-- CREATE POLICY "Allow authenticated update" ON branch_kpi_targets
--   FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
-- CREATE POLICY "Allow authenticated delete" ON branch_kpi_targets
--   FOR DELETE TO authenticated USING (true);

COMMIT;
*/


/*
═══════════════════════════════════════════════════════════════════════════
SANITY CHECKS — להרצה ידנית אחרי המיגרציה
═══════════════════════════════════════════════════════════════════════════

-- 1. RLS פעיל על כל הטבלאות הרלוונטיות:
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'branch_revenue','branch_expenses','branch_labor','branch_waste',
    'fixed_costs','employees','factory_sales','factory_b2b_sales',
    'suppliers','supplier_invoices','unified_suppliers','branch_suppliers',
    'branch_credit_customers','branch_kpi_targets','system_settings','branch_employees',
    'branch_messages','message_reads'
  )
ORDER BY tablename;
-- מצופה: כל 18 השורות עם rowsecurity = true

-- 2. ספירת policies לכל טבלה:
SELECT tablename, COUNT(*) AS policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'branch_revenue','branch_expenses','branch_labor','branch_waste',
    'fixed_costs','employees','factory_sales','factory_b2b_sales',
    'suppliers','supplier_invoices','unified_suppliers','branch_suppliers',
    'branch_credit_customers','branch_kpi_targets','system_settings','branch_employees',
    'branch_messages','message_reads'
  )
GROUP BY tablename
ORDER BY tablename;
-- מצופה: רובן עם policy_count = 1.
--        system_settings   = 2 (SELECT + manage)
--        branch_employees  = 2 (select_all + write_scoped)

-- 3. פורמטים של entity_type ב-fixed_costs (לאימות ההנחה):
SELECT DISTINCT entity_type, COUNT(*) AS rows
FROM fixed_costs
GROUP BY entity_type
ORDER BY entity_type;
-- מצופה: רק 'factory', 'branch_1', 'branch_2', 'branch_3'
-- אם יש ערכים אחרים — לעצור ולדווח!

-- 4. ערכי managed_department ב-app_users factory users:
SELECT managed_department, COUNT(*)
FROM app_users
WHERE role = 'factory'
GROUP BY managed_department;

-- 5. רשימת כל ה-policies שנוצרו (כולל תחביר כדי לראות מה רץ בפועל):
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'branch_revenue','branch_expenses','branch_labor','branch_waste',
    'fixed_costs','employees','factory_sales','factory_b2b_sales',
    'suppliers','supplier_invoices','unified_suppliers','branch_suppliers',
    'branch_credit_customers','branch_kpi_targets','system_settings','branch_employees',
    'branch_messages','message_reads'
  )
ORDER BY tablename, policyname;
*/
