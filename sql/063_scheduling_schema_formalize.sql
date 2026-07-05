-- ═══════════════════════════════════════════════════════════════════════════
-- 063: פורמליזציה של סכמת השיבוץ + עמודות תזמון ב-branch_employees
-- ═══════════════════════════════════════════════════════════════════════════
-- תאריך:  2026-07-05
-- רקע:    8 טבלאות השיבוץ נוצרו ידנית ב-Supabase ומעולם לא היו להן קובצי
--         מיגרציה. קובץ זה מתעד את הסכמה (CREATE TABLE IF NOT EXISTS — no-op
--         על טבלאות חיות), משלים עמודות תזמון חסרות ב-branch_employees,
--         ומוסיף את האינדקסים הייחודיים שמאפשרים UPSERT אטומי (תיקון באג
--         שמירת הזמינות) ו-upsert פרסום.
--
-- אידמפוטנטי, אדיטיבי, ללא איבוד נתונים.
--
-- ⚠ סדר הרצה: אם ביקורת מוצאת כפילויות (employee_id,date,shift_id) ב-
--   schedule_constraints — הרץ קודם 067_scheduling_backfill.sql, אחרת
--   יצירת האינדקס הייחודי כאן תיכשל.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── טבלאות הגדרה (config) ────────────────────────────────────────────────

-- branch_shifts — הגדרות משמרות לסניף (בוקר/צהריים/ערב וכו')
CREATE TABLE IF NOT EXISTS branch_shifts (
  id          BIGSERIAL PRIMARY KEY,
  branch_id   INT NOT NULL,
  name        TEXT NOT NULL,
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL,
  days_of_week INT[] NOT NULL DEFAULT '{}',  -- 0=ראשון ... 6=שבת
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- shift_roles — תפקידים במשמרת (קופאי, אופה, מנהל משמרת...)
CREATE TABLE IF NOT EXISTS shift_roles (
  id         BIGSERIAL PRIMARY KEY,
  branch_id  INT NOT NULL,
  name       TEXT NOT NULL,
  color      TEXT DEFAULT '#6366f1',
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- shift_staffing_requirements — כמה מכל תפקיד נדרשים בכל משמרת
CREATE TABLE IF NOT EXISTS shift_staffing_requirements (
  shift_id       BIGINT NOT NULL,
  role_id        BIGINT NOT NULL,
  required_count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (shift_id, role_id)
);

-- employee_role_assignments — אילו תפקידים כל עובד יכול לאייש
CREATE TABLE IF NOT EXISTS employee_role_assignments (
  id          BIGSERIAL PRIMARY KEY,
  employee_id BIGINT NOT NULL,
  role_id     BIGINT NOT NULL,
  UNIQUE (employee_id, role_id)
);

-- special_days — חגים/ימים מיוחדים (branch_id NULL = גלובלי לכל הסניפים)
CREATE TABLE IF NOT EXISTS special_days (
  id                  BIGSERIAL PRIMARY KEY,
  branch_id           INT,
  date                DATE NOT NULL,
  name                TEXT NOT NULL,
  type                TEXT NOT NULL DEFAULT 'holiday',   -- holiday | blocked | busy ...
  staffing_multiplier NUMERIC NOT NULL DEFAULT 1,
  shift_pattern       TEXT NOT NULL DEFAULT 'regular',   -- regular | friday | closed
  source              TEXT DEFAULT 'manual',             -- manual | hebcal
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- ─── טבלאות תפעול (runtime) ──────────────────────────────────────────────

-- schedule_constraints — זמינות שהוגשה ע"י עובד (או הוזנה ידנית ע"י מנהל)
CREATE TABLE IF NOT EXISTS schedule_constraints (
  id                BIGSERIAL PRIMARY KEY,
  branch_id         INT NOT NULL,
  employee_id       BIGINT NOT NULL,
  date              DATE NOT NULL,
  shift_id          BIGINT NOT NULL,
  availability      TEXT NOT NULL DEFAULT 'available'
                    CHECK (availability IN ('available','prefer_not','unavailable')),
  submitted_by_name TEXT,          -- NULL = הגשה עצמית של העובד; שם = הזנה ידנית של מנהל
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- shift_assignments — השיבוץ בפועל (טיוטה + מפורסם)
CREATE TABLE IF NOT EXISTS shift_assignments (
  id          BIGSERIAL PRIMARY KEY,
  branch_id   INT NOT NULL,
  shift_id    BIGINT NOT NULL,
  employee_id BIGINT NOT NULL,
  role_id     BIGINT NOT NULL,
  date        DATE NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- schedule_publications — היסטוריית פרסום סידור שבועי
CREATE TABLE IF NOT EXISTS schedule_publications (
  id           BIGSERIAL PRIMARY KEY,
  branch_id    INT NOT NULL,
  week_start   DATE NOT NULL,
  published_at TIMESTAMPTZ DEFAULT now(),
  published_by UUID,
  UNIQUE (branch_id, week_start)
);

-- ─── עמודות תזמון חסרות ב-branch_employees (נוספו ידנית בעבר) ─────────────
ALTER TABLE branch_employees
  ADD COLUMN IF NOT EXISTS priority            INT  DEFAULT 2,   -- 1=גבוה (משבצים קודם)
  ADD COLUMN IF NOT EXISTS min_shifts_per_week INT  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_shifts_per_week INT  DEFAULT 6,   -- חדש: תקרת משמרות שבועית
  ADD COLUMN IF NOT EXISTS training_status     TEXT DEFAULT 'regular';  -- regular | trainee | mentor

-- ─── אינדקסים ייחודיים (מאפשרים UPSERT) + ביצועים ────────────────────────

-- תיקון הבאג: UPSERT אטומי של זמינות במקום DELETE→INSERT
CREATE UNIQUE INDEX IF NOT EXISTS uq_schedule_constraints_emp_date_shift
  ON schedule_constraints (employee_id, date, shift_id);

-- upsert פרסום לפי (branch_id, week_start) — כבר בשימוש ב-WeeklySchedule
CREATE UNIQUE INDEX IF NOT EXISTS uq_schedule_publications_branch_week
  ON schedule_publications (branch_id, week_start);

-- upsert דרישות איוש לפי (shift_id, role_id) — כבר בשימוש ב-ShiftSettings
CREATE UNIQUE INDEX IF NOT EXISTS uq_staffing_shift_role
  ON shift_staffing_requirements (shift_id, role_id);

-- אינדקסים לשאילתות שבועיות
CREATE INDEX IF NOT EXISTS ix_shift_assignments_branch_date
  ON shift_assignments (branch_id, date);
CREATE INDEX IF NOT EXISTS ix_shift_assignments_emp_date
  ON shift_assignments (employee_id, date);
CREATE INDEX IF NOT EXISTS ix_schedule_constraints_branch_date
  ON schedule_constraints (branch_id, date);

COMMIT;
