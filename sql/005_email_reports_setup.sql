-- ═══════════════════════════════════════════════════════════════════════
-- 005: Email Reports Setup — pg_cron, pg_net, new KPI columns, report log
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Add missing KPI target columns for branch email reports
ALTER TABLE branch_kpi_targets
  ADD COLUMN IF NOT EXISTS basket_target NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transaction_target INTEGER DEFAULT 0;

-- 2. Create report_log table for audit tracking
CREATE TABLE IF NOT EXISTS report_log (
  id SERIAL PRIMARY KEY,
  sent_at TIMESTAMPTZ DEFAULT now(),
  report_type TEXT NOT NULL,          -- 'daily', 'weekly', 'monthly'
  recipient_email TEXT NOT NULL,
  recipient_role TEXT NOT NULL,       -- 'admin', 'factory', 'branch'
  status TEXT NOT NULL DEFAULT 'sent', -- 'sent', 'failed'
  error_message TEXT,
  report_date TEXT NOT NULL           -- the date/period the report covers
);

-- 3. Enable pg_cron and pg_net extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 4. Schedule daily email report trigger
-- Runs at 09:00 UTC (≈12:00 Israel summer / 11:00 Israel winter)
-- Days 0-5 = Sunday–Friday (Saturday is skipped)
SELECT cron.schedule(
  'daily-email-report',
  '0 9 * * 0-5',
  $$
  SELECT net.http_post(
    url := 'https://nlklndgmtmwoacipjyek.supabase.co/functions/v1/send-reports',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"cron_secret": "REPLACE_WITH_YOUR_CRON_SECRET"}'::jsonb
  );
  $$
);
