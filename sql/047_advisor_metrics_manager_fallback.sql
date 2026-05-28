-- ═══════════════════════════════════════════════════════════════════════════
-- 047: Add manager-salary fallback chain to get_branch_advisor_metrics
-- ═══════════════════════════════════════════════════════════════════════════
-- The v1 function only checked current-month employer_costs for managers,
-- so branches without an uploaded payroll showed labor_managers = 0 even
-- when fixed_costs/mgmt had a salary on file. This replaces the function
-- with the same fallback chain calculatePL.ts uses:
--   1. current month employer_costs is_manager=true
--   2. previous month employer_costs is_manager=true (most recent)
--   3. fixed_costs entity_id='mgmt' for current month
--   4. fixed_costs entity_id='mgmt' for the most recent prior month
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_branch_advisor_metrics(p_branch_id INT, p_date DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month_start DATE := DATE_TRUNC('month', p_date)::DATE;
  v_year INT := EXTRACT(YEAR FROM p_date)::INT;
  v_month INT := EXTRACT(MONTH FROM p_date)::INT;
  v_month_key TEXT := TO_CHAR(p_date, 'YYYY-MM');
  v_branch_name TEXT;
  v_manager_salary NUMERIC;
  v_result JSONB;
BEGIN
  SELECT name INTO v_branch_name FROM branches WHERE id = p_branch_id;

  -- Manager salary fallback chain (matches calculatePL.ts)
  -- 1. current month employer_costs is_manager=true
  SELECT COALESCE(SUM(actual_employer_cost), 0)::NUMERIC INTO v_manager_salary
  FROM employer_costs
  WHERE branch_id = p_branch_id AND is_manager = true
    AND year = v_year AND month = v_month;

  -- 2. previous month employer_costs is_manager=true (latest)
  IF v_manager_salary = 0 THEN
    SELECT COALESCE(SUM(actual_employer_cost), 0)::NUMERIC INTO v_manager_salary
    FROM employer_costs
    WHERE branch_id = p_branch_id AND is_manager = true
      AND (year, month) = (
        SELECT year, month FROM employer_costs ec2
        WHERE ec2.branch_id = p_branch_id AND ec2.is_manager = true
          AND (ec2.year < v_year OR (ec2.year = v_year AND ec2.month < v_month))
        ORDER BY year DESC, month DESC LIMIT 1
      );
  END IF;

  -- 3. fixed_costs entity_id='mgmt' for current month
  IF v_manager_salary = 0 THEN
    SELECT COALESCE(SUM(amount), 0)::NUMERIC INTO v_manager_salary
    FROM fixed_costs
    WHERE entity_type = 'branch_' || p_branch_id
      AND entity_id = 'mgmt'
      AND month = v_month_key;
  END IF;

  -- 4. fixed_costs entity_id='mgmt' for the most recent prior month
  IF v_manager_salary = 0 THEN
    SELECT COALESCE(amount, 0)::NUMERIC INTO v_manager_salary
    FROM fixed_costs
    WHERE entity_type = 'branch_' || p_branch_id
      AND entity_id = 'mgmt'
      AND month < v_month_key
    ORDER BY month DESC LIMIT 1;
    v_manager_salary := COALESCE(v_manager_salary, 0);
  END IF;

  WITH
  rev_legacy AS (
    SELECT COALESCE(SUM(amount), 0)::NUMERIC AS amt
    FROM branch_revenue
    WHERE branch_id = p_branch_id AND date >= v_month_start AND date <= p_date
  ),
  rev_closings AS (
    SELECT COALESCE(SUM(cash_sales + credit_sales), 0)::NUMERIC AS amt
    FROM register_closings
    WHERE branch_id = p_branch_id AND date >= v_month_start AND date <= p_date
  ),
  rev_today AS (
    SELECT COALESCE(SUM(cash_sales + credit_sales), 0)::NUMERIC AS amt
    FROM register_closings
    WHERE branch_id = p_branch_id AND date = p_date
  ),
  int_sales AS (
    SELECT COALESCE(SUM(total_amount), 0)::NUMERIC AS amt
    FROM internal_sales
    WHERE branch_id = p_branch_id AND status = 'completed'
      AND order_date >= v_month_start AND order_date <= p_date
  ),
  exp_from_factory AS (
    SELECT COALESCE(SUM(amount), 0)::NUMERIC AS amt
    FROM branch_expenses
    WHERE branch_id = p_branch_id AND from_factory = true
      AND date >= v_month_start AND date <= p_date
  ),
  exp_breakdown AS (
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE expense_type IN ('suppliers', 'supplier')), 0)::NUMERIC AS suppliers_ext,
      COALESCE(SUM(amount) FILTER (WHERE expense_type IN ('repairs', 'repair')), 0)::NUMERIC AS repairs,
      COALESCE(SUM(amount) FILTER (WHERE expense_type IN ('deliveries', 'delivery')), 0)::NUMERIC AS deliveries,
      COALESCE(SUM(amount) FILTER (WHERE expense_type = 'infrastructure'), 0)::NUMERIC AS infra,
      COALESCE(SUM(amount) FILTER (WHERE expense_type NOT IN ('suppliers', 'supplier', 'repairs', 'repair', 'deliveries', 'delivery', 'infrastructure') OR expense_type IS NULL), 0)::NUMERIC AS other
    FROM branch_expenses
    WHERE branch_id = p_branch_id AND from_factory = false
      AND date >= v_month_start AND date <= p_date
  ),
  labor_actual AS (
    SELECT
      COALESCE(SUM(actual_employer_cost) FILTER (WHERE NOT is_manager), 0)::NUMERIC AS workers,
      COUNT(*) FILTER (WHERE NOT is_manager) > 0 AS has_worker_data
    FROM employer_costs
    WHERE branch_id = p_branch_id AND year = v_year AND month = v_month
  ),
  labor_fallback AS (
    SELECT COALESCE(SUM(employer_cost), 0)::NUMERIC AS amt
    FROM branch_labor
    WHERE branch_id = p_branch_id AND date >= v_month_start AND date <= p_date
  ),
  waste_mtd AS (
    SELECT COALESCE(SUM(amount), 0)::NUMERIC AS amt
    FROM branch_waste
    WHERE branch_id = p_branch_id AND date >= v_month_start AND date <= p_date
  ),
  fixed_mtd AS (
    SELECT COALESCE(SUM(amount), 0)::NUMERIC AS amt
    FROM fixed_costs
    WHERE entity_type = 'branch_' || p_branch_id
      AND (entity_id IS NULL OR entity_id <> 'mgmt')
      AND month = v_month_key
  ),
  targets AS (
    SELECT
      COALESCE(labor_pct, 28)::NUMERIC AS labor_pct,
      COALESCE(waste_pct, 3)::NUMERIC AS waste_pct
    FROM branch_kpi_targets WHERE branch_id = p_branch_id
  )
  SELECT jsonb_build_object(
    'entity_type', 'branch',
    'entity_id', p_branch_id,
    'entity_name', v_branch_name,
    'date', p_date,
    'period', v_month_key,
    'mtd', jsonb_build_object(
      'revenue', (rev_legacy.amt + rev_closings.amt),
      'suppliers_internal', CASE WHEN int_sales.amt > 0 THEN int_sales.amt ELSE exp_from_factory.amt END,
      'suppliers_external', exp_breakdown.suppliers_ext,
      'labor_workers', CASE WHEN labor_actual.has_worker_data THEN labor_actual.workers ELSE labor_fallback.amt END,
      'labor_managers', v_manager_salary,
      'labor_is_actual', labor_actual.has_worker_data,
      'waste', waste_mtd.amt,
      'repairs', exp_breakdown.repairs,
      'deliveries', exp_breakdown.deliveries,
      'infrastructure', exp_breakdown.infra,
      'other_expenses', exp_breakdown.other,
      'fixed_costs', fixed_mtd.amt
    ),
    'today', jsonb_build_object(
      'revenue', rev_today.amt
    ),
    'targets', jsonb_build_object(
      'labor_pct', COALESCE((SELECT labor_pct FROM targets), 28),
      'waste_pct', COALESCE((SELECT waste_pct FROM targets), 3)
    )
  ) INTO v_result
  FROM rev_legacy, rev_closings, rev_today, int_sales, exp_from_factory,
       exp_breakdown, labor_actual, labor_fallback, waste_mtd, fixed_mtd;

  RETURN v_result;
END;
$$;
