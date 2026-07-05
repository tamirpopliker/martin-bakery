-- ═══════════════════════════════════════════════════════════════════════════
-- 066: בדיקות אימות ל-RLS של השיבוץ (064)  —  לא רץ אוטומטית!
-- ═══════════════════════════════════════════════════════════════════════════
-- תאריך:  2026-07-05
-- שימוש:  הרץ כל בלוק ידנית ב-SQL editor אחרי 064, כדי לוודא שההרשאות עובדות.
--         מחליף auth.uid() באמצעות set_config על request.jwt.claims (כפי ש-
--         PostgREST מזריק בפרודקשן). החלף את ה-UUID-ים/IDs בערכים אמיתיים.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 0. אימות ש-RLS פעיל על כל 8 הטבלאות ─────────────────────────────────
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'branch_shifts','shift_roles','shift_staffing_requirements',
    'employee_role_assignments','special_days','schedule_constraints',
    'shift_assignments','schedule_publications'
  )
ORDER BY tablename;
-- מצופה: 8 שורות, כולן rowsecurity = true

-- ─── 1. ספירת policies לכל טבלה ──────────────────────────────────────────
SELECT tablename, COUNT(*) AS policies
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'branch_shifts','shift_roles','shift_staffing_requirements',
    'employee_role_assignments','special_days','schedule_constraints',
    'shift_assignments','schedule_publications'
  )
GROUP BY tablename ORDER BY tablename;
-- מצופה: schedule_constraints=1 ; שאר הטבלאות=2 (read + write)

/*
-- ═══════════════════════════════════════════════════════════════════════
-- 2. בדיקות impersonation — הרץ כל תרחיש בטרנזקציה נפרדת (ROLLBACK בסוף).
--    שנה :EMP_A_UID / :EMP_A_ID / :EMP_B_ID / :BRANCH לערכים אמיתיים.
-- ═══════════════════════════════════════════════════════════════════════

-- (א) עובד A כותב זמינות לעצמו → צריך להצליח
BEGIN;
SELECT set_config('role','authenticated', true);
SELECT set_config('request.jwt.claims',
  json_build_object('sub','<EMP_A_UID>','role','authenticated')::text, true);
INSERT INTO schedule_constraints (branch_id, employee_id, date, shift_id, availability)
VALUES (<BRANCH>, <EMP_A_ID>, '2026-07-12', <SHIFT_ID>, 'unavailable')
ON CONFLICT (employee_id, date, shift_id) DO UPDATE SET availability = EXCLUDED.availability;
-- מצופה: INSERT 0 1 (הצלחה)
ROLLBACK;

-- (ב) עובד A מנסה לכתוב זמינות לעובד B → צריך להיכשל (42501 / 0 rows)
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub','<EMP_A_UID>','role','authenticated')::text, true);
INSERT INTO schedule_constraints (branch_id, employee_id, date, shift_id, availability)
VALUES (<BRANCH>, <EMP_B_ID>, '2026-07-12', <SHIFT_ID>, 'unavailable');
-- מצופה: ERROR new row violates row-level security policy
ROLLBACK;

-- (ג) עובד A קורא סידור מפורסם של הסניף שלו → צריך להצליח (עמיתים)
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub','<EMP_A_UID>','role','authenticated')::text, true);
SELECT count(*) FROM shift_assignments WHERE branch_id = <BRANCH>;
-- מצופה: מספר >= 0 בלי שגיאה
ROLLBACK;

-- (ד) מנהל סניף B מנסה לכתוב assignment בסניף A → צריך להיכשל
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub','<MANAGER_B_UID>','role','authenticated')::text, true);
INSERT INTO shift_assignments (branch_id, shift_id, employee_id, role_id, date)
VALUES (<BRANCH_A>, <SHIFT_ID>, <EMP_A_ID>, <ROLE_ID>, '2026-07-12');
-- מצופה: ERROR row-level security
ROLLBACK;
*/
