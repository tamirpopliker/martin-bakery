-- ═══════════════════════════════════════════════════════════════════════════
-- 068: internal_sales_by_dept — אגרגציה בצד-שרת של מכירות פנימיות לפי מחלקה
-- ═══════════════════════════════════════════════════════════════════════════
-- תאריך:  2026-07-08
-- רקע:    דשבורד המפעל חישב את פירוק המכירות הפנימיות לפי מחלקה ע"י שליפת כל
--         שורות internal_sale_items לצד-לקוח וסכימה. Supabase מחזיר מקסימום
--         1000 שורות כברירת מחדל, ובחודש עמוס (למשל יוני 2026 = 1326 פריטים)
--         הגלגול נחתך → הפירוק והטבלה למחלקות הראו סכומים נמוכים מדי (פער ~128K)
--         וניפחו את "% עלות ייצור" של בצקים. RPC שמסכם בצד-שרת פותר את זה לגמרי.
--
-- STABLE + SECURITY INVOKER — מכבד RLS (הדשבורד נגיש רק ל-admin/factory).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.internal_sales_by_dept(p_from date, p_to date)
RETURNS TABLE(department text, total numeric)
LANGUAGE sql
STABLE
AS $$
  SELECT i.department,
         SUM(i.quantity_supplied * i.unit_price) AS total
  FROM internal_sale_items i
  JOIN internal_sales s ON s.id = i.sale_id
  WHERE s.status = 'completed'
    AND s.order_date >= p_from
    AND s.order_date <  p_to
  GROUP BY i.department;
$$;

GRANT EXECUTE ON FUNCTION public.internal_sales_by_dept(date, date) TO authenticated;

-- אימות ידני (מצופה: סכום total ≈ סכום internal_sales.total_amount לאותו חודש):
--   SELECT department, total FROM internal_sales_by_dept('2026-06-01','2026-07-01') ORDER BY total DESC;
--   SELECT SUM(total) FROM internal_sales_by_dept('2026-06-01','2026-07-01');  -- ~604,755
