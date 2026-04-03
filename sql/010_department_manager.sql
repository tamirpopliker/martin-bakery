-- Add managed_department column to app_users
-- Values: 'creams' / 'dough' / 'packaging' / 'cleaning' / NULL
ALTER TABLE app_users
ADD COLUMN IF NOT EXISTS managed_department TEXT DEFAULT NULL;

-- Set department managers
UPDATE app_users SET managed_department = 'dough'
WHERE email = 'roztamir1976@gmail.com';

UPDATE app_users SET managed_department = 'creams'
WHERE email = 'naor2708@gmail.com';
