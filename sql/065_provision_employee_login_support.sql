-- ═══════════════════════════════════════════════════════════════════════════
-- 065: תמיכה בהקמת כניסה לעובד (username + חיוב החלפת סיסמה ראשונית)
-- ═══════════════════════════════════════════════════════════════════════════
-- תאריך:  2026-07-05
-- רקע:    מוכרים נכנסים דרך שם-משתמש → אימייל סינתטי username@martin.local.
--         ה-Edge Function provision-employee-login יוצר משתמש Supabase Auth
--         ומקשר app_users. שתי עמודות תומכות בזרימה:
--           username             — שם המשתמש להצגה/חיפוש (ללא הסיומת)
--           must_change_password — לכפות החלפת PIN בכניסה הראשונה
--
-- אידמפוטנטי ואדיטיבי.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS username             TEXT,
  ADD COLUMN IF NOT EXISTS must_change_password  BOOLEAN DEFAULT FALSE;

-- username ייחודי (אך מאפשר NULL למשתמשי אימייל/Google שאין להם שם משתמש)
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_users_username
  ON app_users (lower(username)) WHERE username IS NOT NULL;

-- ─── ניקוי דגל החלפת סיסמה (self-service) ────────────────────────────────
-- RLS על app_users מתיר כתיבה ל-admin בלבד, כך שעובד לא יכול לנקות בעצמו את
-- must_change_password. פונקציית SECURITY DEFINER צרה שמעדכנת אך ורק את
-- הבוליאני הזה, ורק לשורת המשתמש הנוכחי (auth.uid()).
CREATE OR REPLACE FUNCTION public.clear_must_change_password()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE app_users SET must_change_password = FALSE WHERE auth_uid = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.clear_must_change_password() FROM public;
GRANT EXECUTE ON FUNCTION public.clear_must_change_password() TO authenticated;

COMMIT;

-- ─── הערה על handle_new_auth_user (032) ──────────────────────────────────
-- ה-Edge Function מבצע INSERT ישיר ל-app_users עם auth_uid מוכן. הטריגר
-- handle_new_auth_user (032) רץ AFTER INSERT ON auth.users ומשתמש ב-
-- "NOT EXISTS (... WHERE lower(email)=lower(NEW.email))" לפני INSERT, ו-
-- COALESCE ב-UPDATE — כך שאין כפילות גם אם ה-Function כבר יצר את השורה.
-- לא נדרש שינוי בטריגר.
