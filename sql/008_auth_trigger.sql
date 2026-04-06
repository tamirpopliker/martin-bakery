-- Auto-provision app_users when a new user signs in via Google OAuth
-- If their email exists in branch_employees, they get role='employee'

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_auth_user();

CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS TRIGGER AS $$
DECLARE
  v_branch_id INT;
  v_name TEXT;
BEGIN
  -- Find employee by email
  SELECT branch_id, name
  INTO v_branch_id, v_name
  FROM branch_employees
  WHERE email = NEW.email
  LIMIT 1;

  -- If found and no app_users record exists yet
  IF v_branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM app_users WHERE email = NEW.email
  ) THEN
    INSERT INTO app_users (email, name, role, branch_id, auth_uid)
    VALUES (
      NEW.email,
      COALESCE(v_name, NEW.raw_user_meta_data->>'full_name', NEW.email),
      'employee',
      v_branch_id,
      NEW.id
    );
  END IF;

  -- If app_users exists but missing auth_uid — update it
  UPDATE app_users
  SET auth_uid = NEW.id
  WHERE email = NEW.email AND auth_uid IS NULL;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();
