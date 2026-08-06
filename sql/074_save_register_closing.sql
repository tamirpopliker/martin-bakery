-- 074_save_register_closing.sql
--
-- Atomic register closing.
--
-- Replaces the client sequence in RegisterClosings.tsx::save(): INSERT
-- register_closings, SELECT the change_fund balance, then 0-2 INSERTs into
-- change_fund. The running balance is read-then-written, and a failure after
-- the closing lands leaves the fund movements missing with no trace.
--
-- Sales arrive GROSS, exactly as they are typed on the screen and spoken out
-- loud. VAT is removed here, at the write boundary, so the formula lives in
-- one place. Storing gross would overstate every P&L by 18%.
--
-- Formulas mirror the screen exactly:
--   expected  = opening + cashGross
--   variance  = counted - expected
--   deposit   = cashGross
--   nextOpen  = variance to fund ? opening : counted - cashGross
--
-- Verified against the live database (inside a rolled-back transaction):
--   opening 400, cash 1320, counted 2090 -> variance +370
--   surplus_fund -> next opening 400 · kept -> next opening 770
--   gross 1320 stored as 1118.64 net

CREATE OR REPLACE FUNCTION save_register_closing(
  p_branch_id       INT,
  p_date            DATE,
  p_register_number INT,
  p_cash_gross      NUMERIC,
  p_credit_gross    NUMERIC,
  p_check_gross     NUMERIC,
  p_transactions    INT,
  p_counted_cash    NUMERIC,
  p_variance_action TEXT DEFAULT NULL,
  p_next_opening    NUMERIC DEFAULT NULL,
  p_notes           TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_vat          CONSTANT NUMERIC := 1.18;
  v_opening      NUMERIC;
  v_expected     NUMERIC;
  v_variance     NUMERIC;
  v_default_next NUMERIC;
  v_chosen_next  NUMERIC;
  v_opening_delta NUMERIC;
  v_balance      NUMERIC;
  v_closing_id   INT;
  v_action       TEXT;
BEGIN
  IF p_cash_gross IS NULL OR p_cash_gross < 0
     OR COALESCE(p_credit_gross, 0) < 0 OR COALESCE(p_check_gross, 0) < 0 THEN
    RAISE EXCEPTION 'סכומי מכירות לא תקינים';
  END IF;
  IF p_counted_cash IS NULL OR p_counted_cash < 0 THEN
    RAISE EXCEPTION 'סכום המזומן שנספר לא תקין';
  END IF;
  IF COALESCE(p_transactions, 0) <= 0 THEN
    RAISE EXCEPTION 'מספר העסקאות חייב להיות גדול מאפס';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('change_fund_' || p_branch_id));

  -- There is no unique constraint on (branch, date, register), so duplicates
  -- are possible at the table level. Blocked here.
  IF EXISTS (
    SELECT 1 FROM register_closings
     WHERE branch_id = p_branch_id AND date = p_date AND register_number = p_register_number
  ) THEN
    RAISE EXCEPTION 'כבר קיימת סגירה לקופה % בתאריך %', p_register_number, TO_CHAR(p_date, 'DD/MM/YYYY');
  END IF;

  -- Opening balance carries from the previous closing of this register.
  SELECT next_opening_balance INTO v_opening
    FROM register_closings
   WHERE branch_id = p_branch_id AND register_number = p_register_number AND date < p_date
   ORDER BY date DESC, created_at DESC
   LIMIT 1;
  v_opening := ROUND(COALESCE(v_opening, 0), 2);

  v_expected := v_opening + p_cash_gross;
  v_variance := ROUND(p_counted_cash - v_expected, 2);

  v_action := CASE WHEN ABS(v_variance) >= 0.01 THEN p_variance_action ELSE NULL END;
  IF v_action IS NOT NULL AND v_action NOT IN ('surplus_fund','documented','kept') THEN
    RAISE EXCEPTION 'טיפול בסטייה לא תקין';
  END IF;
  IF ABS(v_variance) >= 0.01 AND v_action IS NULL THEN
    RAISE EXCEPTION 'יש לבחור כיצד לטפל בסטייה';
  END IF;

  v_default_next := ROUND(
    CASE WHEN v_action = 'surplus_fund' AND ABS(v_variance) > 0.009
         THEN v_opening
         ELSE p_counted_cash - p_cash_gross
    END, 2);
  v_chosen_next := ROUND(COALESCE(p_next_opening, v_default_next), 2);

  INSERT INTO register_closings (
    branch_id, date, register_number, opening_balance,
    cash_sales, credit_sales, check_sales, transaction_count,
    actual_cash, deposit_amount, variance, variance_action,
    next_opening_balance, notes
  ) VALUES (
    p_branch_id, p_date, p_register_number, v_opening,
    ROUND(p_cash_gross / v_vat, 2),
    ROUND(COALESCE(p_credit_gross, 0) / v_vat, 2),
    ROUND(COALESCE(p_check_gross, 0) / v_vat, 2),
    p_transactions,
    ROUND(p_counted_cash, 2), ROUND(p_cash_gross, 2),
    v_variance, v_action,
    v_chosen_next, NULLIF(TRIM(COALESCE(p_notes, '')), '')
  ) RETURNING id INTO v_closing_id;

  -- Fund movements, in the same order the screen queues them.
  SELECT balance_after INTO v_balance
    FROM change_fund WHERE branch_id = p_branch_id
    ORDER BY created_at DESC LIMIT 1;
  IF v_balance IS NULL THEN
    SELECT COALESCE(value::NUMERIC, 0) INTO v_balance
      FROM system_settings WHERE key = 'change_fund_base_' || p_branch_id;
    v_balance := COALESCE(v_balance, 0);
  END IF;

  IF ABS(v_variance) >= 0.01 AND v_action = 'surplus_fund' THEN
    v_balance := v_balance + v_variance;
    INSERT INTO change_fund (branch_id, date, type, amount, description,
                             balance_after, related_closing_id, related_register_number)
    VALUES (p_branch_id, p_date, 'auto_from_closing', v_variance,
            'פער מסגירת קופה ' || p_register_number || ' (' || TO_CHAR(p_date, 'YYYY-MM-DD') || ')',
            v_balance, v_closing_id, p_register_number);
  END IF;

  v_opening_delta := ROUND(v_chosen_next - v_default_next, 2);
  IF ABS(v_opening_delta) > 0.009 THEN
    v_balance := v_balance - v_opening_delta;
    INSERT INTO change_fund (branch_id, date, type, amount, description,
                             balance_after, related_closing_id, related_register_number)
    VALUES (p_branch_id, p_date,
            CASE WHEN v_opening_delta > 0 THEN 'withdraw_to_register' ELSE 'push_from_register' END,
            -v_opening_delta,
            CASE WHEN v_opening_delta > 0
                 THEN 'הגדלת יתרת פתיחה מחר לקופה ' || p_register_number
                 ELSE 'הקטנת יתרת פתיחה מחר מקופה ' || p_register_number END,
            v_balance, v_closing_id, p_register_number);
  END IF;

  RETURN jsonb_build_object(
    'id', v_closing_id,
    'opening', v_opening,
    'expected', v_expected,
    'variance', v_variance,
    'deposit', ROUND(p_cash_gross, 2),
    'next_opening', v_chosen_next,
    'fund_balance', v_balance
  );
END;
$$;

COMMENT ON FUNCTION save_register_closing IS
  'Atomic register closing + change-fund movements. Sales in GROSS, stored net of 18% VAT. Mirrors RegisterClosings.tsx::save().';

GRANT EXECUTE ON FUNCTION save_register_closing TO authenticated, service_role;
