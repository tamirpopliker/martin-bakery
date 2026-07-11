-- ═══════════════════════════════════════════════════════════════════════════
-- 070: אפשר source='credit_b2b' ב-branch_revenue (הקפה מחשבוניות B2B)
-- ═══════════════════════════════════════════════════════════════════════════
-- תאריך:  2026-07-11
-- רקע:    ה-CHECK constraint branch_revenue_source_check לא כלל את הערך
--         'credit_b2b'. לכן כל ניסיון של B2BCustomers ליצור שורת הכנסה
--         לחשבונית B2B נדחה בשקט (safeDbOperation תפס את השגיאה), והחשבוניות
--         לא זרמו לדשבורדים של הסניפים. כאן מרחיבים את ה-constraint ומאפשרים
--         את הערך, ואז אפשר לבצע backfill לחשבוניות הקיימות.
--
-- אידמפוטנטי.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE branch_revenue DROP CONSTRAINT IF EXISTS branch_revenue_source_check;
ALTER TABLE branch_revenue ADD CONSTRAINT branch_revenue_source_check
  CHECK (source IN ('cashier', 'website', 'credit', 'credit_b2b'));

-- ─── Backfill: שורת credit_b2b לכל חשבונית B2B של סניף שאין לה עדיין ─────────
INSERT INTO branch_revenue (branch_id, date, source, amount, doc_number)
SELECT i.branch_id, i.invoice_date, 'credit_b2b', i.total_before_vat, i.invoice_number
FROM b2b_invoices i
WHERE i.branch_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM branch_revenue br
    WHERE br.source = 'credit_b2b'
      AND br.branch_id = i.branch_id
      AND br.doc_number = i.invoice_number
  );
