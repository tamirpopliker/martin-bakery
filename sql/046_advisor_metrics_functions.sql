-- ═══════════════════════════════════════════════════════════════════════════
-- 046: SQL functions that aggregate metrics for the daily-insights advisor
-- ═══════════════════════════════════════════════════════════════════════════
-- Three RPC functions, one per entity type. Each returns a JSON object the
-- Edge Function will send to Claude as the analysis context. All numbers are
-- month-to-date (MTD) through the given date, plus a "today" snapshot for
-- comparison.
--
-- Conventions match calculatePL.ts:
--   - Labor priority: employer_costs → branch_labor fallback
--   - Manager salary: employer_costs is_manager=true → fixed_costs mgmt fallback
--   - Internal sales priority: branch_expenses from_factory=true over internal_sales
--   - Waste NOT deducted from controllable/operating profit (KPI only)
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Branch metrics ─────────────────────────────────────────────────────────
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
  v_branch_name TEXT;
  v_result JSONB;
BEGIN
  SELECT name INTO v_branch_name FROM branches WHERE id = p_branch_id;

  WITH
  -- Revenue MTD (legacy branch_revenue + register_closings)
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
  -- Today's revenue (closings only — primary source nowadays)
  rev_today AS (
    SELECT COALESCE(SUM(cash_sales + credit_sales), 0)::NUMERIC AS amt
    FROM register_closings
    WHERE branch_id = p_branch_id AND date = p_date
  ),
  -- Internal supplier purchases (prefer internal_sales completed, fallback branch_expenses from_factory)
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
  -- External suppliers + other expense buckets
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
  -- Labor: prefer employer_costs (actual), fallback branch_labor (estimate)
  labor_actual AS (
    SELECT
      COALESCE(SUM(actual_employer_cost) FILTER (WHERE NOT is_manager), 0)::NUMERIC AS workers,
      COALESCE(SUM(actual_employer_cost) FILTER (WHERE is_manager), 0)::NUMERIC AS managers,
      COUNT(*) > 0 AS has_data
    FROM employer_costs
    WHERE branch_id = p_branch_id AND year = v_year AND month = v_month
  ),
  labor_fallback AS (
    SELECT COALESCE(SUM(employer_cost), 0)::NUMERIC AS amt
    FROM branch_labor
    WHERE branch_id = p_branch_id AND date >= v_month_start AND date <= p_date
  ),
  -- Waste MTD
  waste_mtd AS (
    SELECT COALESCE(SUM(amount), 0)::NUMERIC AS amt
    FROM branch_waste
    WHERE branch_id = p_branch_id AND date >= v_month_start AND date <= p_date
  ),
  -- Fixed costs MTD (excluding mgmt — that's manager salary)
  fixed_mtd AS (
    SELECT COALESCE(SUM(amount), 0)::NUMERIC AS amt
    FROM fixed_costs
    WHERE entity_type = 'branch_' || p_branch_id
      AND (entity_id IS NULL OR entity_id <> 'mgmt')
      AND month = TO_CHAR(p_date, 'YYYY-MM')
  ),
  -- Targets
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
    'period', TO_CHAR(p_date, 'YYYY-MM'),
    'mtd', jsonb_build_object(
      'revenue', (rev_legacy.amt + rev_closings.amt),
      'suppliers_internal', CASE WHEN int_sales.amt > 0 THEN int_sales.amt ELSE exp_from_factory.amt END,
      'suppliers_external', exp_breakdown.suppliers_ext,
      'labor_workers', CASE WHEN labor_actual.has_data THEN labor_actual.workers ELSE labor_fallback.amt END,
      'labor_managers', labor_actual.managers,
      'labor_is_actual', labor_actual.has_data,
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

-- ─── Factory metrics ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_factory_advisor_metrics(p_date DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month_start DATE := DATE_TRUNC('month', p_date)::DATE;
  v_year INT := EXTRACT(YEAR FROM p_date)::INT;
  v_month INT := EXTRACT(MONTH FROM p_date)::INT;
  v_result JSONB;
BEGIN
  WITH
  sales_ext AS (
    SELECT
      COALESCE((SELECT SUM(amount) FROM factory_sales WHERE is_internal = false AND date >= v_month_start AND date <= p_date), 0)::NUMERIC
      + COALESCE((SELECT SUM(amount) FROM factory_b2b_sales WHERE is_internal = false AND date >= v_month_start AND date <= p_date), 0)::NUMERIC
      + COALESCE((SELECT SUM(total_before_vat) FROM external_sales WHERE invoice_date >= v_month_start AND invoice_date <= p_date), 0)::NUMERIC
      AS amt
  ),
  sales_int AS (
    SELECT
      COALESCE((SELECT SUM(total_amount) FROM internal_sales WHERE status = 'completed' AND order_date >= v_month_start AND order_date <= p_date), 0)::NUMERIC
      AS amt
  ),
  suppliers_mtd AS (
    SELECT COALESCE(SUM(amount), 0)::NUMERIC AS amt
    FROM supplier_invoices WHERE date >= v_month_start AND date <= p_date
  ),
  labor_actual AS (
    SELECT
      COALESCE(SUM(actual_employer_cost) FILTER (WHERE NOT is_manager), 0)::NUMERIC AS workers,
      COALESCE(SUM(actual_employer_cost) FILTER (WHERE is_manager), 0)::NUMERIC AS managers,
      COUNT(*) > 0 AS has_data
    FROM employer_costs
    WHERE branch_id IS NULL AND is_headquarters = false
      AND year = v_year AND month = v_month
  ),
  labor_fallback AS (
    SELECT COALESCE(SUM(employer_cost), 0)::NUMERIC AS amt
    FROM labor
    WHERE entity_type = 'factory' AND date >= v_month_start AND date <= p_date
  ),
  waste_mtd AS (
    SELECT COALESCE(SUM(amount), 0)::NUMERIC AS amt
    FROM factory_waste WHERE date >= v_month_start AND date <= p_date
  ),
  repairs_mtd AS (
    SELECT COALESCE(SUM(amount), 0)::NUMERIC AS amt
    FROM factory_repairs WHERE date >= v_month_start AND date <= p_date
  ),
  fixed_mtd AS (
    SELECT COALESCE(SUM(amount), 0)::NUMERIC AS amt
    FROM fixed_costs WHERE entity_type = 'factory' AND month = TO_CHAR(p_date, 'YYYY-MM')
  )
  SELECT jsonb_build_object(
    'entity_type', 'factory',
    'entity_id', NULL,
    'entity_name', 'מפעל',
    'date', p_date,
    'period', TO_CHAR(p_date, 'YYYY-MM'),
    'mtd', jsonb_build_object(
      'revenue_external', sales_ext.amt,
      'revenue_internal', sales_int.amt,
      'suppliers', suppliers_mtd.amt,
      'labor_workers', CASE WHEN labor_actual.has_data THEN labor_actual.workers ELSE labor_fallback.amt END,
      'labor_managers', labor_actual.managers,
      'labor_is_actual', labor_actual.has_data,
      'waste', waste_mtd.amt,
      'repairs', repairs_mtd.amt,
      'fixed_costs', fixed_mtd.amt
    )
  ) INTO v_result
  FROM sales_ext, sales_int, suppliers_mtd, labor_actual, labor_fallback,
       waste_mtd, repairs_mtd, fixed_mtd;

  RETURN v_result;
END;
$$;

-- ─── Consolidated metrics (whole company) ───────────────────────────────────
CREATE OR REPLACE FUNCTION get_consolidated_advisor_metrics(p_date DATE)
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
  v_factory := get_factory_advisor_metrics(p_date);

  SELECT jsonb_agg(get_branch_advisor_metrics(id, p_date) ORDER BY id) INTO v_branches
  FROM branches WHERE active = true;

  v_result := jsonb_build_object(
    'entity_type', 'consolidated',
    'entity_id', NULL,
    'entity_name', 'מאוחד',
    'date', p_date,
    'period', TO_CHAR(p_date, 'YYYY-MM'),
    'factory', v_factory,
    'branches', v_branches
  );

  RETURN v_result;
END;
$$;

-- Grant execute to authenticated users (RLS still controls daily_insights table access)
GRANT EXECUTE ON FUNCTION get_branch_advisor_metrics(INT, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_factory_advisor_metrics(DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_consolidated_advisor_metrics(DATE) TO authenticated, service_role;
