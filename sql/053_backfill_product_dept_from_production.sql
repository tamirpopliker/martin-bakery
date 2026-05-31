-- ═══════════════════════════════════════════════════════════════════════════
-- 053: Backfill product→department from production_reports
-- ═══════════════════════════════════════════════════════════════════════════
-- The InternalSalesUpload form defaults new items to department='אחר' and
-- only updates product_department_mapping when a non-'אחר' item is saved.
-- production_reports has the authoritative per-item department for everything
-- the factory has ever produced — backfilling from there in two steps:
--
--   A) Enrich product_department_mapping with every product that appears in
--      production_reports under a real department. Latest entry wins on
--      conflict so manual corrections in ProductCatalog stay intact.
--   B) Re-tag historical internal_sale_items rows still sitting on 'אחר'
--      (or NULL) using the enriched mapping. Anything truly never produced
--      stays 'אחר' for follow-up tagging.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── A. Enrich product_department_mapping ────────────────────────────────────
INSERT INTO product_department_mapping (product_name, department)
SELECT DISTINCT ON (product_name) product_name, department
FROM production_reports
WHERE department IS NOT NULL
  AND department <> 'אחר'
ORDER BY product_name, report_date DESC
ON CONFLICT (product_name) DO UPDATE
  SET department = EXCLUDED.department;

-- ─── B. Re-tag stale internal_sale_items ─────────────────────────────────────
UPDATE internal_sale_items i
SET department = m.department
FROM product_department_mapping m
WHERE i.product_name = m.product_name
  AND (i.department IS NULL OR i.department = 'אחר')
  AND m.department <> 'אחר';

-- ─── Quick audit (run AFTER and inspect) ─────────────────────────────────────
-- Distribution of departments after the backfill — 'אחר' should shrink.
--
--   SELECT COALESCE(department, '(NULL)') AS d, COUNT(*) AS items,
--          ROUND(SUM(quantity_supplied * unit_price)::numeric, 2) AS total
--   FROM internal_sale_items
--   GROUP BY d ORDER BY items DESC;
--
-- And which product names are still untagged (these need manual mapping):
--
--   SELECT product_name, COUNT(*) AS occurrences
--   FROM internal_sale_items
--   WHERE department IS NULL OR department = 'אחר'
--   GROUP BY product_name ORDER BY occurrences DESC LIMIT 50;
