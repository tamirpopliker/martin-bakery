-- ═══════════════════════════════════════════════════════════════════════
-- 005: Email Reports Setup — new KPI columns + report log
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

-- NOTE: Scheduling is handled by external cron service (cron-job.org)
-- that calls the Edge Function URL daily at 09:00 UTC.
-- pg_cron is not available on Supabase Free plan.
