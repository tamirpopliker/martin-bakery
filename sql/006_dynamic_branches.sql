-- ═══════════════════════════════════════════════════════════════════════
-- 006: Dynamic Branches — טבלת סניפים דינמית
-- ═══════════════════════════════════════════════════════════════════════

-- 1. טבלת סניפים
CREATE TABLE IF NOT EXISTS branches (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  short_name TEXT,
  address TEXT DEFAULT '',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Seed: 3 הסניפים הקיימים
INSERT INTO branches (id, name, short_name, address, active) VALUES
  (1, 'אברהם אבינו', 'אברהם אבינו', '', true),
  (2, 'הפועלים', 'הפועלים', '', true),
  (3, 'יעקב כהן', 'יעקב כהן', '', true)
ON CONFLICT (id) DO NOTHING;

-- Advance sequence past existing IDs
SELECT setval('branches_id_seq', (SELECT MAX(id) FROM branches));

-- 3. RLS
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Everyone can read branches" ON branches
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage branches" ON branches
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users au
      WHERE au.auth_uid = auth.uid() AND au.role = 'admin'
    )
  );
