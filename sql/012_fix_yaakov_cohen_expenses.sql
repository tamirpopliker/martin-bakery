-- Retroactive fix: create branch_expenses for approved factory orders
-- for Yaakov Cohen branch (branch_id = 3)
-- This handles orders that were approved before the auto-create logic was added

INSERT INTO branch_expenses (branch_id, date, type, supplier, amount, doc_number, from_factory, notes)
SELECT
  3 as branch_id,
  fs.date,
  'supplier' as type,
  'מפעל ייצור' as supplier,
  fs.amount,
  COALESCE(fs.doc_number, 'factory_factory_sales_' || fs.id) as doc_number,
  true as from_factory,
  'יבוא רטרואקטיבי — הזמנה פנימית מאושרת' as notes
FROM factory_sales fs
WHERE fs.is_internal = true
AND fs.target_branch_id = 3
AND fs.branch_status = 'approved'
AND NOT EXISTS (
  SELECT 1 FROM branch_expenses be
  WHERE be.doc_number = COALESCE(fs.doc_number, 'factory_factory_sales_' || fs.id)
  AND be.branch_id = 3
  AND be.from_factory = true
);

-- Also fix for all other branches (in case they have the same issue)
INSERT INTO branch_expenses (branch_id, date, type, supplier, amount, doc_number, from_factory, notes)
SELECT
  fs.target_branch_id as branch_id,
  fs.date,
  'supplier' as type,
  'מפעל ייצור' as supplier,
  fs.amount,
  COALESCE(fs.doc_number, 'factory_factory_sales_' || fs.id) as doc_number,
  true as from_factory,
  'יבוא רטרואקטיבי — הזמנה פנימית מאושרת' as notes
FROM factory_sales fs
WHERE fs.is_internal = true
AND fs.target_branch_id != 3
AND fs.target_branch_id IS NOT NULL
AND fs.branch_status = 'approved'
AND NOT EXISTS (
  SELECT 1 FROM branch_expenses be
  WHERE be.doc_number = COALESCE(fs.doc_number, 'factory_factory_sales_' || fs.id)
  AND be.branch_id = fs.target_branch_id
  AND be.from_factory = true
);
