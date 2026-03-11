-- 1. Check how many records are marked internal
SELECT 'factory_sales' as tbl, 
  COUNT(*) FILTER (WHERE is_internal = true) as internal_count,
  COUNT(*) FILTER (WHERE is_internal = false) as external_count,
  SUM(amount) FILTER (WHERE is_internal = true) as internal_total,
  SUM(amount) FILTER (WHERE is_internal = false) as external_total
FROM factory_sales
UNION ALL
SELECT 'factory_b2b_sales',
  COUNT(*) FILTER (WHERE is_internal = true),
  COUNT(*) FILTER (WHERE is_internal = false),
  SUM(amount) FILTER (WHERE is_internal = true),
  SUM(amount) FILTER (WHERE is_internal = false)
FROM factory_b2b_sales;

-- 2. Show all distinct customer names that contain 'מרטין'
SELECT DISTINCT customer, is_internal, target_branch_id, COUNT(*) as cnt, SUM(amount) as total
FROM (
  SELECT customer, is_internal, target_branch_id, amount FROM factory_sales
  UNION ALL
  SELECT customer, is_internal, target_branch_id, amount FROM factory_b2b_sales
) combined
WHERE customer LIKE '%מרטין%'
GROUP BY customer, is_internal, target_branch_id
ORDER BY total DESC;
