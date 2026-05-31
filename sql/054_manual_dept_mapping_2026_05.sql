-- ═══════════════════════════════════════════════════════════════════════════
-- 054: Manual product→department mapping for items production reports missed
-- ═══════════════════════════════════════════════════════════════════════════
-- After sql/053 backfilled product_department_mapping from production_reports,
-- 92 internal_sale_items rows (₪63K) were still tagged 'אחר' because their
-- products never appeared in a production report (frozen-dough purchases,
-- raw materials sold to branches, niche items).
--
-- The user reviewed the top 19 product names — covering all 92 occurrences —
-- and provided manual department classifications:
--   - frozen dough products → בצקים
--   - finished pastries / desserts → קרמים
--   - raw ingredients sold to branches (spices, supplies) → שונות
--
-- Same two-step pattern as 053: enrich product_department_mapping, then
-- back-propagate to internal_sale_items.
-- ═══════════════════════════════════════════════════════════════════════════

WITH manual_mapping (product_name, department) AS (
  VALUES
    ('בורקס גבינה בצק קפוא 5 ק"ג',          'בצקים'),
    ('וניל בצק קפוא 6 ק"ג',                  'בצקים'),
    ('גביניות עלים בצק קפוא 6 ק"ג',          'בצקים'),
    ('חלות (בצק)',                            'בצקים'),
    ('מגשית פטיסרי 230',                     'שונות'),
    ('מסת כדורי שוקולד חלבי - 10 ק"ג',       'בצקים'),
    ('מסת כדורי שוקולד פרווה -10 ק"ג',       'בצקים'),
    ('באסקית פיסטוק',                         'קרמים'),
    ('בחושה פרג ושוקולד לבן',                 'בצקים'),
    ('טארט לימון אישי',                       'קרמים'),
    ('קינוח בוטנים ושוקולד חלב -אישי',        'קרמים'),
    ('קינוח הדרים ומנגו אישי',                'קרמים'),
    ('קוקוס לבן',                             'קרמים'),
    ('טארט פירות יער אישי',                   'קרמים'),
    ('שק זילוף ירוק (קרטון מכיל 72 יח'')',    'שונות'),
    ('אגוז מלך טחון',                         'שונות'),
    ('קרואפין בצק',                           'בצקים'),
    ('קצח',                                   'שונות'),
    ('סינבון',                                'בצקים')
)
INSERT INTO product_department_mapping (product_name, department)
SELECT product_name, department FROM manual_mapping
ON CONFLICT (product_name) DO UPDATE SET department = EXCLUDED.department;

-- Re-tag historical internal_sale_items for these products
UPDATE internal_sale_items i
SET department = m.department
FROM product_department_mapping m
WHERE i.product_name = m.product_name
  AND (i.department IS NULL OR i.department = 'אחר')
  AND m.department <> 'אחר';

-- Audit (run AFTER and inspect) — 'אחר' should now be empty or near-empty:
--   SELECT COALESCE(department, '(NULL)') AS d, COUNT(*) AS items,
--          ROUND(SUM(quantity_supplied * unit_price)::numeric, 2) AS total
--   FROM internal_sale_items
--   GROUP BY d ORDER BY items DESC;
