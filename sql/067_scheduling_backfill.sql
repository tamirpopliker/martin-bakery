-- ═══════════════════════════════════════════════════════════════════════════
-- 067: dedup ל-schedule_constraints  —  מותנה! הרץ רק אם יש כפילויות.
-- ═══════════════════════════════════════════════════════════════════════════
-- תאריך:  2026-07-05
-- רקע:    האינדקס הייחודי (employee_id,date,shift_id) ב-063 ייכשל אם קיימות
--         כפילויות. הרץ את בדיקת הביקורת; אם היא מחזירה שורות — הרץ את בלוק
--         ה-dedup לפני 063.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── ביקורת (קריאה בלבד): כמה כפילויות יש? ───────────────────────────────
SELECT employee_id, date, shift_id, COUNT(*) AS copies
FROM schedule_constraints
GROUP BY employee_id, date, shift_id
HAVING COUNT(*) > 1
ORDER BY copies DESC;
-- אם 0 שורות → אין צורך ב-dedup; דלג ישר ל-063.

/*
-- ─── dedup: משאירים את השורה העדכנית ביותר (updated_at הכי גבוה) ──────────
BEGIN;

DELETE FROM schedule_constraints sc
USING (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY employee_id, date, shift_id
           ORDER BY updated_at DESC NULLS LAST, id DESC
         ) AS rn
  FROM schedule_constraints
) dup
WHERE sc.id = dup.id
  AND dup.rn > 1;

-- אימות: אמור להחזיר 0 שורות אחרי ה-DELETE
SELECT employee_id, date, shift_id, COUNT(*)
FROM schedule_constraints
GROUP BY employee_id, date, shift_id
HAVING COUNT(*) > 1;

COMMIT;
*/
