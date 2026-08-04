-- 072_change_fund_movement.sql
--
-- Atomic change-fund movement.
--
-- Replaces the client-side sequence in ChangeFund.tsx::submitAction, which
-- reads the running balance, then writes register_closings, then writes
-- change_fund — three steps with no transaction. Two problems:
--
--   1. The balance is read-then-written. Two movements landing together both
--      read the same balance_after and the second silently overwrites the
--      first's arithmetic.
--   2. A withdraw/push writes register_closings first. If the change_fund
--      insert then fails, the register's opening balance has moved and
--      nothing records why.
--
-- This function does all of it in one transaction, under a per-branch
-- advisory lock, so the balance chain cannot interleave.
--
-- Behaviour mirrors applyRegisterOpeningChange exactly — same max(0, ...)
-- clamps, same stub-closing shape, same Hebrew error. Do not "improve" it
-- here without changing the screen too.
--
-- `reset` is deliberately NOT supported: it rewrites the base-fund setting,
-- which is configuration rather than a daily movement.

CREATE OR REPLACE FUNCTION change_fund_movement(
  p_branch_id       INT,
  p_type            TEXT,
  p_amount          NUMERIC,
  p_description     TEXT    DEFAULT NULL,
  p_register_number INT     DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_today          DATE := CURRENT_DATE;
  v_signed         NUMERIC;
  v_delta          NUMERIC;          -- change to the register's opening
  v_balance        NUMERIC;
  v_new_balance    NUMERIC;
  v_latest         register_closings%ROWTYPE;
  v_closing_id     INT := NULL;
  v_opening_before NUMERIC;
  v_new_cash       NUMERIC;
  v_desc           TEXT;
  v_id             BIGINT;
BEGIN
  IF p_type NOT IN ('income','expense','withdraw_to_register','push_from_register') THEN
    RAISE EXCEPTION 'סוג תנועה לא נתמך';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'הסכום חייב להיות גדול מאפס';
  END IF;

  IF p_type IN ('withdraw_to_register','push_from_register') AND p_register_number IS NULL THEN
    RAISE EXCEPTION 'יש לציין מספר קופה';
  END IF;

  -- Serialise the balance chain for this branch.
  PERFORM pg_advisory_xact_lock(hashtext('change_fund_' || p_branch_id));

  -- Current balance: last movement, else the configured base, else zero.
  SELECT balance_after INTO v_balance
    FROM change_fund
   WHERE branch_id = p_branch_id
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_balance IS NULL THEN
    SELECT COALESCE(value::NUMERIC, 0) INTO v_balance
      FROM system_settings
     WHERE key = 'change_fund_base_' || p_branch_id;
    v_balance := COALESCE(v_balance, 0);
  END IF;

  v_signed := CASE p_type
    WHEN 'income'               THEN  p_amount
    WHEN 'expense'              THEN -p_amount
    WHEN 'withdraw_to_register' THEN -p_amount
    WHEN 'push_from_register'   THEN  p_amount
  END;

  v_desc := COALESCE(NULLIF(TRIM(p_description), ''), CASE p_type
    WHEN 'withdraw_to_register' THEN 'משיכה לקופה ' || p_register_number
    WHEN 'push_from_register'   THEN 'דחיפה מקופה ' || p_register_number
    ELSE NULL
  END);

  -- ── Register side ──
  IF p_type IN ('withdraw_to_register','push_from_register') THEN
    v_delta := CASE WHEN p_type = 'withdraw_to_register' THEN p_amount ELSE -p_amount END;

    SELECT * INTO v_latest
      FROM register_closings
     WHERE branch_id = p_branch_id AND register_number = p_register_number
     ORDER BY date DESC, created_at DESC
     LIMIT 1;

    IF FOUND THEN
      IF v_latest.date = v_today THEN
        UPDATE register_closings
           SET next_opening_balance = GREATEST(0, v_latest.next_opening_balance + v_delta),
               actual_cash          = GREATEST(0, v_latest.actual_cash + v_delta),
               notes                = COALESCE(v_latest.notes || ' · ', '') || v_desc
         WHERE id = v_latest.id;
        v_closing_id := v_latest.id;
      ELSE
        v_opening_before := v_latest.next_opening_balance;
        v_new_cash := GREATEST(0, v_opening_before + v_delta);
        INSERT INTO register_closings (
          branch_id, date, register_number, opening_balance,
          cash_sales, credit_sales, transaction_count,
          actual_cash, deposit_amount, variance, variance_action,
          next_opening_balance, notes
        ) VALUES (
          p_branch_id, v_today, p_register_number, v_opening_before,
          0, 0, 0,
          v_new_cash, 0, v_delta, NULL,
          v_new_cash, v_desc
        ) RETURNING id INTO v_closing_id;
      END IF;
    ELSE
      -- No history for this register. Seeding an opening is only meaningful
      -- when money is going in.
      IF v_delta > 0 THEN
        INSERT INTO register_closings (
          branch_id, date, register_number, opening_balance,
          cash_sales, credit_sales, transaction_count,
          actual_cash, deposit_amount, variance, variance_action,
          next_opening_balance, notes
        ) VALUES (
          p_branch_id, v_today, p_register_number, 0,
          0, 0, 0,
          v_delta, 0, v_delta, NULL,
          v_delta, v_desc
        ) RETURNING id INTO v_closing_id;
      ELSE
        RAISE EXCEPTION 'לא ניתן לבצע דחיפה מקופה שאין לה יתרת פתיחה';
      END IF;
    END IF;
  END IF;

  -- ── Fund side ──
  v_new_balance := v_balance + v_signed;

  INSERT INTO change_fund (
    branch_id, date, type, amount, description,
    balance_after, related_register_number, related_closing_id
  ) VALUES (
    p_branch_id, v_today, p_type, v_signed, v_desc,
    v_new_balance, p_register_number, v_closing_id
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'id', v_id,
    'balance_before', v_balance,
    'balance_after', v_new_balance,
    'amount', v_signed,
    'related_closing_id', v_closing_id
  );
END;
$$;

COMMENT ON FUNCTION change_fund_movement IS
  'Atomic change-fund movement: balance chain + register opening adjustment in one transaction. Mirrors ChangeFund.tsx::applyRegisterOpeningChange.';

GRANT EXECUTE ON FUNCTION change_fund_movement TO authenticated, service_role;
