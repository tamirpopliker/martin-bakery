-- ╔════════════════════════════════════════════════════════════════╗
-- ║  app_users — טבלת משתמשים והרשאות                              ║
-- ╚════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS app_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'factory', 'branch')),
  branch_id INT,                      -- for branch users (1=אברהם אבינו, 2=הפועלים, 3=יעקב כהן)
  excluded_departments TEXT[] DEFAULT '{}',  -- for factory users: departments they CAN'T see
  can_settings BOOLEAN DEFAULT FALSE,
  auth_uid UUID,                      -- linked to Supabase auth.users.id after first login
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Seed data
INSERT INTO app_users (email, name, role, branch_id, excluded_departments, can_settings) VALUES
  ('guyl.martin1964@gmail.com', 'גיא לוראן', 'admin', NULL, '{}', TRUE),
  ('tamirpopliker@gmail.com', 'טמיר', 'admin', NULL, '{}', TRUE),
  ('naor2708@gmail.com', 'נאור אורן', 'factory', NULL, '{dough}', FALSE),
  ('roztamir1976@gmail.com', 'תמיר רוזנברג', 'factory', NULL, '{creams}', FALSE),
  ('zosap18@gmail.com', 'זהר ספונוב', 'branch', 3, '{}', FALSE),
  ('kobi0480@gmail.com', 'קובי לוי', 'branch', 2, '{}', FALSE),
  ('avi29030@gmail.com', 'אבי חורב', 'branch', 1, '{}', FALSE)
ON CONFLICT (email) DO NOTHING;

-- Allow authenticated users to read their own record
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read all app_users" ON app_users
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage app_users" ON app_users
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users au
      WHERE au.auth_uid = auth.uid() AND au.role = 'admin'
    )
  );
