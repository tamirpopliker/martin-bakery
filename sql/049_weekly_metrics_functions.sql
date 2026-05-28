-- ═══════════════════════════════════════════════════════════════════════════
-- 049: Weekly aggregation functions for the weekly-insights advisor
-- ═══════════════════════════════════════════════════════════════════════════
-- Replaces the MTD (month-to-date) helpers from 046/047 with date-range
-- equivalents. Each function takes (period_start, period_end) and returns
-- the same JSON shape as before — only the aggregation window differs.
--
-- Fixed-cost / manager-salary handling:
--   These are inherently monthly. We pro-rate them to the period length
--   (period_days / days_in_month_of_period_end) so the labor/profit math
--   compares apples-to-apples with weekly variable costs.
--
-- Manager-salary fallback chain (matches calculatePL.ts):
--   1. period-month employer_costs is_manager=true
--   2. latest prior month employer_costs is_manager=true
--   3. period-month fixed_costs entity_id='mgmt'
--   4. latest prior month fixed_costs entity_id='mgmt'
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop old daily/MTD functions (no longer needed)
DROP FUNCTION IF EXISTS get_branch_advisor_metrics(INT, DATE);
DROP FUNCTION IF EXISTS get_factory_advisor_metrics(DATE);
DROP FUNCTION IF EXISTS get_consolidated_advisor_metrics(DATE);

-- ─── Branch metrics ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_branch_weekly_metrics(
  p_branch_id INT,
  p_period_start DATE,
  p_period_end DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year INT := EXTRACT(YEAR FROM p_period_end)::INT;
  v_month INT := EXTRACT(MONTH FROM p_period_end)::INT;
  v_month_key TEXT := TO_CHAR(p_period_end, 'YYYY-MM');
  v_days_in_month INT := EXTRACT(DAY FROM (DATE_TRUNC('month', p_period_end) + INTERVAL '1 month - 1 day'))::INT;
  v_period_days INT := (p_period_end - p_period_start + 1);
  v_proration NUMERIC := v_period_days::NUMERIC / v_days_in_month::NUMERIC;
  v_branch_name TEXT;
  v_manager_salary_monthly NUMERIC := 0;
  v_result JSONB;
BEGIN
  SELECT name INTO v_branch_name FROM branches WHERE id = p_branch_id;

  -- Manager salary fallback chain (same as calculatePL.ts)
  -- 1. period-month employer_costs is_manager=true
  SELECT COALESCE(SUM(actual_employer_cost), 0)::NUMERIC INTO v_manager_salary_monthly
  FROM employer_costs
  WHERE branch_id = p_branch_id AND is_manager = true
    AND year = v_year AND month = v_month;

  -- 2. previous month employer_costs is_manager=true
  IF v_manager_salary_monthly = 0 THEN
    SELECT COALESCE(SUM(actual_employer_cost), 0)::NUMERIC INTO v_manager_salary_monthly
    FROM employer_costs
    WHERE branch_id = p_branch_id AND is_manager = true
      AND (year, month) = (
        SELECT year, month FROM employer_costs ec2
        WHERE ec2.branch_id = p_branch_id AND ec2.is_manager = true
          AND (ec2.year < v_year OR (ec2.year = v_year AND ec2.month < v_month))
        ORDER BY year DESC, month DESC LIMIT 1
      );
  END IF;

  -- 3. period-month fixed_costs entity_id='mgmt'
  IF v_manager_salary_monthly = 0 THEN
    SELECT COALESCE(SUM(amount), 0)::NUMERIC INTO v_manager_salary_monthly
    FROM fixed_costs
    WHERE entity_type = 'branch_' || p_branch_id
      AND entity_id = 'mgmt'
      AND month = v_month_key;
  END IF;

  -- 4. latest prior month fixed_costs entity_id='mgmt'
  IF v_manager_salary_monthly = 0 THEN
    SELECT COALESCE(amount, 0)::NUMERIC INTO v_manager_salary_monthly
    FROM fixed_costs
    WHERE entity_type = 'branch_' || p_branch_id
      AND entity_id = 'mgmt'
      AND month < v_month_key
    ORDER BY month DESC LIMIT 1;
    v_manager_salary_monthly := COALESCE(v_manager_salary_monthly, 0);
  END IF;

  WITH
  -- Period revenue (legacy branch_revenue + register_closings)
  rev_legacy AS (
    SELECT COALESCE(SUM(amount), 0)::NUMERIC AS amt
    FROM branch_revenue
    WHERE branch_id = p_branch_id AND date >= p_period_start AND date <= p_period_end
  ),
  rev_closings AS (
    SELECT COALESCE(SUM(cash_sales + credit_sales), 0)::NUMERIC AS amt
    FROM register_closings
    WHERE branch_id = p_branch_id AND date >= p_period_start AND date <= p_period_end
  ),
  -- Internal supplier purchases (prefer internal_sales completed)
  int_sales AS (
    SELECT COALESCE(SUM(total_amount), 0)::NUMERIC AS amt
    FROM internal_sales
    WHERE branch_id = p_branch_id AND status = 'completed'
      AND order_date >= p_period_start AND order_date <= p_period_end
  ),
  exp_from_factory AS (
    SELECT COALESCE(SUM(amount), 0)::NUMERIC AS amt
    FROM branch_expenses
    WHERE branch_id = p_branch_id AND from_factory = true
      AND date >= p_period_start AND date <= p_period_end
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
      AND date >= p_period_start AND date <= p_period_end
  ),
  -- Worker labor (non-manager) for the period
  -- Prefer employer_costs (monthly figure, pro-rated); fallback branch_labor (date-based, already weekly)
  labor_actual_monthly AS (
    SELECT
      COALESCE(SUM(actual_employer_cost) FILTER (WHERE NOT is_manager), 0)::NUMERIC AS workers_monthly,
      COUNT(*) FILTER (WHERE NOT is_manager) > 0 AS has_data
    FROM employer_costs
    WHERE branch_id = p_branch_id AND year = v_year AND month = v_month
  ),
  labor_fallback_period AS (
    SELECT COALESCE(SUM(employer_cost), 0)::NUMERIC AS amt
    FROM branch_labor
    WHERE branch_id = p_branch_id AND date >= p_period_start AND date <= p_period_end
  ),
  waste_period AS (
    SELECT COALESCE(SUM(amount), 0)::NUMERIC AS amt
    FROM branch_waste
    WHERE branch_id = p_branch_id AND date >= p_period_start AND date <= p_period_end
  ),
  fixed_monthly AS (
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
    'period_start', p_period_start,
    'period_end', p_period_end,
    'period_days', v_period_days,
    'proration_factor', ROUND(v_proration, 4),
    'period', jsonb_build_object(
      'revenue', (rev_legacy.amt + rev_closings.amt),
      'suppliers_internal', CASE WHEN int_sales.amt > 0 THEN int_sales.amt ELSE exp_from_factory.amt END,
      'suppliers_external', exp_breakdown.suppliers_ext,
      'labor_workers',
        CASE
          WHEN labor_actual_monthly.has_data THEN ROUND(labor_actual_monthly.workers_monthly * v_proration, 2)
          ELSE labor_fallback_period.amt
        END,
      'labor_managers_prorated', ROUND(v_manager_salary_monthly * v_proration, 2),
      'labor_is_actual', labor_actual_monthly.has_data,
      'waste', waste_period.amt,
      'repairs', exp_breakdown.repairs,
      'deliveries', exp_breakdown.deliveries,
      'infrastructure', exp_breakdown.infra,
      'other_expenses', exp_breakdown.other,
      'fixed_costs_prorated', ROUND(fixed_monthly.amt * v_proration, 2)
    ),
    'monthly_context', jsonb_build_object(
      'manager_salary_full_month', v_manager_salary_monthly,
      'fixed_costs_full_month', fixed_monthly.amt,
      'days_in_month', v_days_in_month
    ),
    'targets', jsonb_build_object(
      'labor_pct', COALESCE((SELECT labor_pct FROM targets), 28),
      'waste_pct', COALESCE((SELECT waste_pct FROM targets), 3)
    )
  ) INTO v_result
  FROM rev_legacy, rev_closings, int_sales, exp_from_factory,
       exp_breakdown, labor_actual_monthly, labor_fallback_period,
       waste_period, fixed_monthly;

  RETURN v_result;
END;
$$;

-- ─── Factory metrics ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_factory_weekly_metrics(
  p_period_start DATE,
  p_period_end DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year INT := EXTRACT(YEAR FROM p_period_end)::INT;
  v_month INT := EXTRACT(MONTH FROM p_period_end)::INT;
  v_month_key TEXT := TO_CHAR(p_period_end, 'YYYY-MM');
  v_days_in_month INT := EXTRACT(DAY FROM (DATE_TRUNC('month', p_period_end) + INTERVAL '1 month - 1 day'))::INT;
  v_period_days INT := (p_period_end - p_period_start + 1);
  v_proration NUMERIC := v_period_days::NUMERIC / v_days_in_month::NUMERIC;
  v_result JSONB;
BEGIN
  WITH
  sales_ext AS (
    SELECT
      COALESCE((SELECT SUM(amount) FROM factory_sales WHERE is_internal = false AND date >= p_period_start AND date <= p_period_end), 0)::NUMERIC
      + COALESCE((SELECT SUM(amount) FROM factory_b2b_sales WHERE is_internal = false AND date >= p_period_start AND date <= p_period_end), 0)::NUMERIC
      + COALESCE((SELECT SUM(total_before_vat) FROM external_sales WHERE invoice_date >= p_period_start AND invoice_date <= p_period_end), 0)::NUMERIC
      AS amt
  ),
  sales_int AS (
    SELECT
      COALESCE((SELECT SUM(total_amount) FROM internal_sales WHERE status = 'completed' AND order_date >= p_period_start AND order_date <= p_period_end), 0)::NUMERIC
      AS amt
  ),
  suppliers_period AS (
    SELECT COALESCE(SUM(amount), 0)::NUMERIC AS amt
    FROM supplier_invoices WHERE date >= p_period_start AND date <= p_period_end
  ),
  labor_actual_monthly AS (
    SELECT
      COALESCE(SUM(actual_employer_cost) FILTER (WHERE NOT is_manager), 0)::NUMERIC AS workers_monthly,
      COALESCE(SUM(actual_employer_cost) FILTER (WHERE is_manager), 0)::NUMERIC AS managers_monthly,
      COUNT(*) > 0 AS has_data
    FROM employer_costs
    WHERE branch_id IS NULL AND is_headquarters = false
      AND year = v_year AND month = v_month
  ),
  labor_fallback_period AS (
    SELECT COALESCE(SUM(employer_cost), 0)::NUMERIC AS amt
    FROM labor
    WHERE entity_type = 'factory' AND date >= p_period_start AND date <= p_period_end
  ),
  waste_period AS (
    SELECT COALESCE(SUM(amount), 0)::NUMERIC AS amt
    FROM factory_waste WHERE date >= p_period_start AND date <= p_period_end
  ),
  repairs_period AS (
    SELECT COALESCE(SUM(amount), 0)::NUMERIC AS amt
    FROM factory_repairs WHERE date >= p_period_start AND date <= p_period_end
  ),
  fixed_monthly AS (
    SELECT COALESCE(SUM(amount), 0)::NUMERIC AS amt
    FROM fixed_costs WHERE entity_type = 'factory' AND month = v_month_key
  )
  SELECT jsonb_build_object(
    'entity_type', 'factory',
    'entity_id', NULL,
    'entity_name', 'מפעל',
    'period_start', p_period_start,
    'period_end', p_period_end,
    'period_days', v_period_days,
    'proration_factor', ROUND(v_proration, 4),
    'period', jsonb_build_object(
      'revenue_external', sales_ext.amt,
      'revenue_internal', sales_int.amt,
      'suppliers', suppliers_period.amt,
      'labor_workers',
        CASE
          WHEN labor_actual_monthly.has_data THEN ROUND(labor_actual_monthly.workers_monthly * v_proration, 2)
          ELSE labor_fallback_period.amt
        END,
      'labor_managers_prorated', ROUND(labor_actual_monthly.managers_monthly * v_proration, 2),
      'labor_is_actual', labor_actual_monthly.has_data,
      'waste', waste_period.amt,
      'repairs', repairs_period.amt,
      'fixed_costs_prorated', ROUND(fixed_monthly.amt * v_proration, 2)
    ),
    'monthly_context', jsonb_build_object(
      'manager_salary_full_month', labor_actual_monthly.managers_monthly,
      'fixed_costs_full_month', fixed_monthly.amt,
      'days_in_month', v_days_in_month
    )
  ) INTO v_result
  FROM sales_ext, sales_int, suppliers_period, labor_actual_monthly,
       labor_fallback_period, waste_period, repairs_period, fixed_monthly;

  RETURN v_result;
END;
$$;

-- ─── Consolidated metrics ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_consolidated_weekly_metrics(
  p_period_start DATE,
  p_period_end DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_factory JSONB;
  v_branches JSONB;
  v_result JSONB;
BEGIN
  v_factory := get_factory_weekly_metrics(p_period_start, p_period_end);

  SELECT jsonb_agg(get_branch_weekly_metrics(id, p_period_start, p_period_end) ORDER BY id) INTO v_branches
  FROM branches WHERE active = true;

  v_result := jsonb_build_object(
    'entity_type', 'consolidated',
    'entity_id', NULL,
    'entity_name', 'מאוחד',
    'period_start', p_period_start,
    'period_end', p_period_end,
    'factory', v_factory,
    'branches', v_branches
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_branch_weekly_metrics(INT, DATE, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_factory_weekly_metrics(DATE, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_consolidated_weekly_metrics(DATE, DATE) TO authenticated, service_role;
