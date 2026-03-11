-- ============================================================
-- תיקון: סימון כל המכירות הפנימיות (כולל וריאציות שמות)
-- הרץ את הסקריפט ב-Supabase SQL Editor
-- ============================================================

-- 1. סימון כל הרשומות שמכילות "מרטין" בשם הלקוח

-- factory_sales: מרטין + אברהם → סניף 1
UPDATE factory_sales
SET is_internal = true,
    target_branch_id = 1,
    branch_status = COALESCE(branch_status, 'approved')
WHERE customer LIKE '%מרטין%'
  AND customer LIKE '%אברהם%'
  AND is_internal = false;

-- factory_sales: מרטין + עמק שרה → סניף 2
UPDATE factory_sales
SET is_internal = true,
    target_branch_id = 2,
    branch_status = COALESCE(branch_status, 'approved')
WHERE customer LIKE '%מרטין%'
  AND customer LIKE '%עמק שרה%'
  AND is_internal = false;

-- factory_sales: מרטין + יעקב → סניף 3
UPDATE factory_sales
SET is_internal = true,
    target_branch_id = 3,
    branch_status = COALESCE(branch_status, 'approved')
WHERE customer LIKE '%מרטין%'
  AND customer LIKE '%יעקב%'
  AND is_internal = false;

-- factory_sales: כל "מרטין" שנשאר — ברירת מחדל סניף 1
UPDATE factory_sales
SET is_internal = true,
    target_branch_id = 1,
    branch_status = COALESCE(branch_status, 'approved')
WHERE customer LIKE '%מרטין%'
  AND is_internal = false;

-- factory_b2b_sales: מרטין + אברהם → סניף 1
UPDATE factory_b2b_sales
SET is_internal = true,
    target_branch_id = 1,
    branch_status = COALESCE(branch_status, 'approved')
WHERE customer LIKE '%מרטין%'
  AND customer LIKE '%אברהם%'
  AND is_internal = false;

-- factory_b2b_sales: מרטין + עמק שרה → סניף 2
UPDATE factory_b2b_sales
SET is_internal = true,
    target_branch_id = 2,
    branch_status = COALESCE(branch_status, 'approved')
WHERE customer LIKE '%מרטין%'
  AND customer LIKE '%עמק שרה%'
  AND is_internal = false;

-- factory_b2b_sales: מרטין + יעקב → סניף 3
UPDATE factory_b2b_sales
SET is_internal = true,
    target_branch_id = 3,
    branch_status = COALESCE(branch_status, 'approved')
WHERE customer LIKE '%מרטין%'
  AND customer LIKE '%יעקב%'
  AND is_internal = false;

-- factory_b2b_sales: כל "מרטין" שנשאר — ברירת מחדל סניף 1
UPDATE factory_b2b_sales
SET is_internal = true,
    target_branch_id = 1,
    branch_status = COALESCE(branch_status, 'approved')
WHERE customer LIKE '%מרטין%'
  AND is_internal = false;

-- 2. בדיקה — הצגת כל הלקוחות עם "מרטין" ומצב הסימון
SELECT 'factory_sales' AS source, customer, is_internal, target_branch_id, COUNT(*) AS cnt
FROM factory_sales
WHERE customer LIKE '%מרטין%'
GROUP BY customer, is_internal, target_branch_id
UNION ALL
SELECT 'factory_b2b_sales', customer, is_internal, target_branch_id, COUNT(*)
FROM factory_b2b_sales
WHERE customer LIKE '%מרטין%'
GROUP BY customer, is_internal, target_branch_id
ORDER BY source, customer;
