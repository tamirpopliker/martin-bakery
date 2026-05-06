-- 033: Clean up duplicate branch_employees rows + add UNIQUE constraint
--
-- Background: same employee was sometimes re-created when moved between
-- branches instead of UPDATE branch_id. Result: multiple rows with same
-- name across branches. Investigated cases (as of 2026-05-06):
--   אסף דוד    — 3 rows: id=10 (active br=3, has data), id=12 (inactive br=2, empty), id=31 (inactive br=1, empty)
--   מיכאל שסטרוב — 3 rows: id=21 (active br=2, only 1 role), id=11 (inactive br=3, only 1 role), id=35 (inactive br=1, empty)
--   קיילה ולקרסל — 2 rows: id=39 (active br=1, has data), id=63 (active br=2, only 1 role) ← BOTH active
--   תפארת אלשלם  — 2 rows: id=68 (active br=3, has data), id=72 (active br=2, empty) ← BOTH active
--
-- Strategy:
--   A. Delete inactive rows with NO foreign-key references (safe).
--   B. For inactive rows whose only FK is employee_role_assignments (no
--      schedule_constraints, no shift_assignments) — delete cascade-style.
--   C. Deactivate "empty" duplicates that are still active=true but have no
--      schedule_constraints AND no shift_assignments. Keep them in DB so the
--      role_assignments rows survive (in case someone re-activates).
--   D. Add a partial UNIQUE index on lower(email) WHERE email <> '' AND
--      active=true — prevents the same person from being active twice.

-- ─── A. Delete inactive empty duplicates ─────────────────────────────────────
DELETE FROM branch_employees WHERE id IN (12, 31, 35);

-- ─── B. Delete inactive duplicates with only role_assignments ────────────────
DELETE FROM employee_role_assignments WHERE employee_id = 11;
DELETE FROM branch_employees WHERE id = 11;

-- ─── C. Deactivate active-but-empty duplicates ───────────────────────────────
-- The "real" record (with the data) for each pair is the one we keep active.
-- The empty duplicate is flipped to active=false. Manager can re-activate
-- through UI if it turns out we kept the wrong row.
UPDATE branch_employees SET active = false
WHERE id IN (63, 72);

-- ─── D. Add partial UNIQUE index to prevent future duplicates ────────────────
-- Allow inactive history; one active record per email globally.
DROP INDEX IF EXISTS branch_employees_active_email_uidx;
CREATE UNIQUE INDEX branch_employees_active_email_uidx
  ON branch_employees (lower(email))
  WHERE email IS NOT NULL AND email <> '' AND active = true;

-- ─── Verification (manual — uncomment to run) ────────────────────────────────
-- SELECT name, branch_id, count(*)
-- FROM branch_employees
-- WHERE active = true
-- GROUP BY name, branch_id
-- HAVING count(*) > 1;  -- should return 0 rows
