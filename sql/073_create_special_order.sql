-- 073_create_special_order.sql
--
-- Atomic special-order creation.
--
-- Replaces the client sequence in BranchSpecialOrders.tsx::save():
--   INSERT special_orders -> SELECT app_users -> bulk INSERT order_notifications
-- where a failed notification insert is only console.warn'd. The order then
-- exists and nobody is told about it.
--
-- Also fixes the order number. generateOrderNumber() builds
-- SO-{branch}-{YYYYMMDDHHMMSS} on the client at second resolution against a
-- UNIQUE column, so two orders in the same second from one branch collide.
-- An agent creates orders faster than a person, which makes that likelier.
-- The number is now generated here and retried on conflict.

CREATE OR REPLACE FUNCTION create_special_order(
  p_branch_id      INT,
  p_customer_name  TEXT,
  p_pickup_date    DATE,
  p_type           TEXT,
  p_base_size      TEXT,
  p_coating        TEXT,
  p_crown          TEXT,
  p_torte_flavor   TEXT DEFAULT NULL,
  p_cream_between  TEXT DEFAULT NULL,
  p_filling        TEXT DEFAULT NULL,
  p_preset_cake    TEXT DEFAULT NULL,
  p_pickup_time    TEXT DEFAULT NULL,
  p_customer_phone TEXT DEFAULT NULL,
  p_extras         TEXT[] DEFAULT NULL,
  p_notes          TEXT DEFAULT NULL,
  p_manual_number  TEXT DEFAULT NULL,
  p_created_by     UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_number   TEXT;
  v_id       INT;
  v_torte    TEXT;
  v_cream    TEXT;
  v_filling  TEXT;
  v_attempt  INT := 0;
  v_notified INT := 0;
BEGIN
  IF COALESCE(TRIM(p_customer_name), '') = '' THEN
    RAISE EXCEPTION 'שם לקוח חובה';
  END IF;
  IF p_pickup_date IS NULL THEN
    RAISE EXCEPTION 'תאריך איסוף חובה';
  END IF;
  IF p_type NOT IN ('חלבי', 'פרווה') THEN
    RAISE EXCEPTION 'סוג העוגה חייב להיות חלבי או פרווה';
  END IF;
  IF COALESCE(TRIM(p_base_size), '') = '' THEN
    RAISE EXCEPTION 'גודל וצורת בסיס חובה';
  END IF;
  IF COALESCE(TRIM(p_coating), '') = '' THEN
    RAISE EXCEPTION 'ציפוי חובה';
  END IF;
  IF COALESCE(TRIM(p_crown), '') = '' THEN
    RAISE EXCEPTION 'כתר עליון חובה';
  END IF;

  -- 'עגולה בינונית' is preset mode: the three flavour columns are NOT NULL,
  -- so the form stuffs them with the preset name and preset_cake_name carries
  -- the real signal. Mirrored here.
  IF p_base_size = 'עגולה בינונית' THEN
    IF COALESCE(TRIM(p_preset_cake), '') = '' THEN
      RAISE EXCEPTION 'עוגה עגולה בינונית מחייבת בחירת עוגה מוכנה';
    END IF;
    v_torte   := p_preset_cake;
    v_cream   := p_preset_cake;
    v_filling := p_preset_cake;
  ELSE
    IF COALESCE(TRIM(p_torte_flavor), '') = ''
       OR COALESCE(TRIM(p_cream_between), '') = ''
       OR COALESCE(TRIM(p_filling), '') = '' THEN
      RAISE EXCEPTION 'נדרשים טעם טורט, קרם ומילוי';
    END IF;
    v_torte   := p_torte_flavor;
    v_cream   := p_cream_between;
    v_filling := p_filling;
  END IF;

  LOOP
    v_attempt := v_attempt + 1;
    v_number := 'SO-' || p_branch_id || '-'
             || TO_CHAR(NOW() AT TIME ZONE 'Asia/Jerusalem', 'YYYYMMDDHH24MISS')
             || CASE WHEN v_attempt = 1 THEN '' ELSE '-' || v_attempt END;
    BEGIN
      INSERT INTO special_orders (
        order_number, order_number_manual, branch_id,
        customer_name, customer_phone,
        order_date, pickup_date, pickup_time,
        type, base_size, torte_flavor, cream_between, filling,
        preset_cake_name, coating, crown, extras, notes,
        status, created_by
      ) VALUES (
        v_number, NULLIF(TRIM(COALESCE(p_manual_number, '')), ''), p_branch_id,
        TRIM(p_customer_name), NULLIF(TRIM(COALESCE(p_customer_phone, '')), ''),
        CURRENT_DATE, p_pickup_date, NULLIF(TRIM(COALESCE(p_pickup_time, '')), ''),
        p_type, p_base_size, v_torte, v_cream, v_filling,
        CASE WHEN p_base_size = 'עגולה בינונית' THEN p_preset_cake ELSE NULL END,
        p_coating, p_crown,
        CASE WHEN p_extras IS NOT NULL AND array_length(p_extras, 1) > 0 THEN p_extras ELSE NULL END,
        NULLIF(TRIM(COALESCE(p_notes, '')), ''),
        'new', p_created_by
      ) RETURNING id INTO v_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 20 THEN RAISE EXCEPTION 'לא ניתן להקצות מספר הזמנה'; END IF;
    END;
  END LOOP;

  -- Same transaction: if this fails the order is rolled back too, rather
  -- than existing silently with nobody notified.
  INSERT INTO order_notifications (user_id, order_id, message)
  SELECT u.id, v_id,
         'הזמנת עוגה חדשה מסניף ' || COALESCE(b.short_name, b.name, '') ||
         ' — ' || TRIM(p_customer_name) ||
         ', איסוף ' || TO_CHAR(p_pickup_date, 'DD/MM/YYYY')
    FROM app_users u
    LEFT JOIN branches b ON b.id = p_branch_id
   WHERE u.role IN ('factory', 'admin');
  GET DIAGNOSTICS v_notified = ROW_COUNT;

  RETURN jsonb_build_object(
    'id', v_id,
    'order_number', v_number,
    'notified', v_notified
  );
END;
$$;

COMMENT ON FUNCTION create_special_order IS
  'Atomic special order + factory notifications. Generates a collision-safe order number. Mirrors BranchSpecialOrders.tsx::save().';

GRANT EXECUTE ON FUNCTION create_special_order TO authenticated, service_role;
