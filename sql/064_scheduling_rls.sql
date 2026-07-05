-- ═══════════════════════════════════════════════════════════════════════════
-- 064: RLS על 8 טבלאות השיבוץ  ← הליבה שמתקנת "עובדים לא מצליחים להגיש"
-- ═══════════════════════════════════════════════════════════════════════════
-- תאריך:  2026-07-05
-- רקע:    לטבלאות השיבוץ לא היה RLS מתועד. שמירת זמינות של עובד נכשלה בשקט.
--         כאן מפעילים RLS + policies בתבנית הקבועה של 025_rls_critical.sql.
--
-- עקרון ההרשאה בכל טבלה:
--   admin    → הכל
--   branch   → רק הסניף שלו (u.branch_id = row.branch_id)
--   employee → קורא נתוני הסניף שלו; כותב זמינות רק לשורות שלו-עצמו
--              (u.employee_id = row.employee_id) — לא יכול לגעת בעובד אחר.
--
-- ⚠ הטבלה הכי מסוכנת. אחרי ההרצה — הרץ מיד את בדיקות ה-impersonation ב-
--   066_scheduling_rls_verification.sql מול 5 התפקידים.
--
-- אידמפוטנטי (DROP POLICY IF EXISTS). עטוף בטרנזקציה אחת.
-- כל FOR ALL כולל WITH CHECK כדי למנוע UPDATE שמעביר שורה בין סניפים/עובדים.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── ניקוי policies ישנים לקסיים שנוצרו ידנית ב-Supabase לפני המיגרציה ───
-- הם PERMISSIVE ל-authenticated (ALL/SELECT) ומאוחדים ב-OR עם החדשים — כלומר
-- מבטלים את ההגבלות למטה (וחושפים זמינות של כל עובד). חובה למחוק.
DROP POLICY IF EXISTS "auth manage branch_shifts"     ON branch_shifts;
DROP POLICY IF EXISTS "auth read branch_shifts"       ON branch_shifts;
DROP POLICY IF EXISTS "auth manage era"               ON employee_role_assignments;
DROP POLICY IF EXISTS "auth read era"                 ON employee_role_assignments;
DROP POLICY IF EXISTS "Allow authenticated all"       ON schedule_constraints;
DROP POLICY IF EXISTS "auth manage"                   ON schedule_publications;
DROP POLICY IF EXISTS "auth read"                     ON schedule_publications;
DROP POLICY IF EXISTS "auth manage shift_assignments" ON shift_assignments;
DROP POLICY IF EXISTS "auth read shift_assignments"   ON shift_assignments;
DROP POLICY IF EXISTS "auth manage shift_roles"       ON shift_roles;
DROP POLICY IF EXISTS "auth read shift_roles"         ON shift_roles;
DROP POLICY IF EXISTS "auth manage ssr"               ON shift_staffing_requirements;
DROP POLICY IF EXISTS "auth read ssr"                 ON shift_staffing_requirements;
DROP POLICY IF EXISTS "auth manage"                   ON special_days;
DROP POLICY IF EXISTS "auth read"                     ON special_days;

ALTER TABLE branch_shifts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_roles                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_staffing_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_role_assignments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE special_days                ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_constraints        ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_assignments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_publications       ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════════════════
-- schedule_constraints — זמינות. הליבה של התיקון.
--   SELECT+WRITE: admin | branch-own | employee-self
-- ═══════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "schedule_constraints_access" ON schedule_constraints;
CREATE POLICY "schedule_constraints_access" ON schedule_constraints FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (
          u.role = 'admin'
          OR (u.role = 'branch'   AND u.branch_id   = schedule_constraints.branch_id)
          OR (u.role = 'employee' AND u.employee_id = schedule_constraints.employee_id)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (
          u.role = 'admin'
          OR (u.role = 'branch'   AND u.branch_id   = schedule_constraints.branch_id)
          OR (u.role = 'employee' AND u.employee_id = schedule_constraints.employee_id)
        )
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- employee_role_assignments — אין branch_id → join ל-branch_employees
--   SELECT: admin | employee-self | branch (עובדי הסניף שלו)
--   WRITE:  admin | branch (עובדי הסניף שלו)   [עובד לא כותב תפקידים]
-- ═══════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "employee_role_assignments_read"  ON employee_role_assignments;
DROP POLICY IF EXISTS "employee_role_assignments_write" ON employee_role_assignments;

CREATE POLICY "employee_role_assignments_read" ON employee_role_assignments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (
          u.role = 'admin'
          OR (u.role = 'employee' AND u.employee_id = employee_role_assignments.employee_id)
          OR (u.role = 'branch' AND EXISTS (
                SELECT 1 FROM branch_employees be
                WHERE be.id = employee_role_assignments.employee_id
                  AND be.branch_id = u.branch_id))
        )
    )
  );

CREATE POLICY "employee_role_assignments_write" ON employee_role_assignments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (
          u.role = 'admin'
          OR (u.role = 'branch' AND EXISTS (
                SELECT 1 FROM branch_employees be
                WHERE be.id = employee_role_assignments.employee_id
                  AND be.branch_id = u.branch_id))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (
          u.role = 'admin'
          OR (u.role = 'branch' AND EXISTS (
                SELECT 1 FROM branch_employees be
                WHERE be.id = employee_role_assignments.employee_id
                  AND be.branch_id = u.branch_id))
        )
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- shift_assignments — הסידור בפועל
--   SELECT: admin | branch-own | employee-same-branch (עמיתים ב-MySchedule)
--   WRITE:  admin | branch-own
-- ═══════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "shift_assignments_read"  ON shift_assignments;
DROP POLICY IF EXISTS "shift_assignments_write" ON shift_assignments;

CREATE POLICY "shift_assignments_read" ON shift_assignments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (
          u.role = 'admin'
          OR (u.role IN ('branch','employee') AND u.branch_id = shift_assignments.branch_id)
        )
    )
  );

CREATE POLICY "shift_assignments_write" ON shift_assignments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (u.role = 'admin'
             OR (u.role = 'branch' AND u.branch_id = shift_assignments.branch_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (u.role = 'admin'
             OR (u.role = 'branch' AND u.branch_id = shift_assignments.branch_id))
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- schedule_publications — פרסום סידור
--   SELECT: admin | branch-own | employee-same-branch (MySchedule)
--   WRITE:  admin | branch-own
-- ═══════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "schedule_publications_read"  ON schedule_publications;
DROP POLICY IF EXISTS "schedule_publications_write" ON schedule_publications;

CREATE POLICY "schedule_publications_read" ON schedule_publications FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (
          u.role = 'admin'
          OR (u.role IN ('branch','employee') AND u.branch_id = schedule_publications.branch_id)
        )
    )
  );

CREATE POLICY "schedule_publications_write" ON schedule_publications FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (u.role = 'admin'
             OR (u.role = 'branch' AND u.branch_id = schedule_publications.branch_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (u.role = 'admin'
             OR (u.role = 'branch' AND u.branch_id = schedule_publications.branch_id))
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- טבלאות הגדרה — SELECT פתוח לכל מאומת (עובד חייב לקרוא כדי להגיש/לראות),
--                WRITE מסונן ל-admin + branch-own.
-- ═══════════════════════════════════════════════════════════════════════════

-- branch_shifts
DROP POLICY IF EXISTS "branch_shifts_read"  ON branch_shifts;
DROP POLICY IF EXISTS "branch_shifts_write" ON branch_shifts;
CREATE POLICY "branch_shifts_read" ON branch_shifts
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "branch_shifts_write" ON branch_shifts FOR ALL
  USING (
    EXISTS (SELECT 1 FROM app_users u WHERE u.auth_uid = auth.uid()
      AND (u.role = 'admin' OR (u.role = 'branch' AND u.branch_id = branch_shifts.branch_id)))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM app_users u WHERE u.auth_uid = auth.uid()
      AND (u.role = 'admin' OR (u.role = 'branch' AND u.branch_id = branch_shifts.branch_id)))
  );

-- shift_roles
DROP POLICY IF EXISTS "shift_roles_read"  ON shift_roles;
DROP POLICY IF EXISTS "shift_roles_write" ON shift_roles;
CREATE POLICY "shift_roles_read" ON shift_roles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "shift_roles_write" ON shift_roles FOR ALL
  USING (
    EXISTS (SELECT 1 FROM app_users u WHERE u.auth_uid = auth.uid()
      AND (u.role = 'admin' OR (u.role = 'branch' AND u.branch_id = shift_roles.branch_id)))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM app_users u WHERE u.auth_uid = auth.uid()
      AND (u.role = 'admin' OR (u.role = 'branch' AND u.branch_id = shift_roles.branch_id)))
  );

-- shift_staffing_requirements — אין branch_id → join ל-branch_shifts לצורך WRITE
DROP POLICY IF EXISTS "staffing_read"  ON shift_staffing_requirements;
DROP POLICY IF EXISTS "staffing_write" ON shift_staffing_requirements;
CREATE POLICY "staffing_read" ON shift_staffing_requirements
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "staffing_write" ON shift_staffing_requirements FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (u.role = 'admin'
             OR (u.role = 'branch' AND EXISTS (
                   SELECT 1 FROM branch_shifts s
                   WHERE s.id = shift_staffing_requirements.shift_id
                     AND s.branch_id = u.branch_id)))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.auth_uid = auth.uid()
        AND (u.role = 'admin'
             OR (u.role = 'branch' AND EXISTS (
                   SELECT 1 FROM branch_shifts s
                   WHERE s.id = shift_staffing_requirements.shift_id
                     AND s.branch_id = u.branch_id)))
    )
  );

-- special_days — branch_id NULL = גלובלי. SELECT פתוח; WRITE: admin לכל,
--                branch רק לשורות הסניף שלו (חגים גלובליים = admin בלבד).
DROP POLICY IF EXISTS "special_days_read"  ON special_days;
DROP POLICY IF EXISTS "special_days_write" ON special_days;
CREATE POLICY "special_days_read" ON special_days
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "special_days_write" ON special_days FOR ALL
  USING (
    EXISTS (SELECT 1 FROM app_users u WHERE u.auth_uid = auth.uid()
      AND (u.role = 'admin' OR (u.role = 'branch' AND u.branch_id = special_days.branch_id)))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM app_users u WHERE u.auth_uid = auth.uid()
      AND (u.role = 'admin' OR (u.role = 'branch' AND u.branch_id = special_days.branch_id)))
  );

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK חירום (הרץ ידנית):
--   ALTER TABLE <t> DISABLE ROW LEVEL SECURITY;  לכל 8 הטבלאות, או
--   DROP POLICY IF EXISTS "<name>" ON <t>;
-- ═══════════════════════════════════════════════════════════════════════════
