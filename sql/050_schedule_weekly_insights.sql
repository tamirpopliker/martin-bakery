-- ═══════════════════════════════════════════════════════════════════════════
-- 050: Schedule weekly-insights to run every Monday morning
-- ═══════════════════════════════════════════════════════════════════════════
-- Cron expression: '0 7 * * 1' = 07:00 UTC every Monday.
--   - Israel DST (Apr–Oct): 07:00 UTC = 10:00 IST ✓
--   - Israel standard (Nov–Mar): 07:00 UTC = 09:00 IST (an hour earlier; fine)
-- The function auto-computes the prior Sun-Sat week, so timing within
-- Monday morning is forgiving.
--
-- HOW TO RUN THIS FILE:
--   1. Replace the placeholder YOUR_PUBLISHABLE_KEY_HERE on line 38 with the
--      Publishable key from Settings → API Keys (NOT the secret key).
--   2. Run in Supabase SQL Editor.
--
-- VERIFY AFTER RUNNING:
--   SELECT jobname, schedule, active, jobid FROM cron.job;
--   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
-- ═══════════════════════════════════════════════════════════════════════════

-- Enable required extensions (no-op if already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any previous schedule with this name so re-running is safe
DO $$
BEGIN
  PERFORM cron.unschedule('weekly-insights-monday-10am');
EXCEPTION WHEN OTHERS THEN
  NULL;  -- ignore if job didn't exist
END $$;

-- Schedule the weekly run
SELECT cron.schedule(
  'weekly-insights-monday-10am',
  '0 7 * * 1',  -- 07:00 UTC every Monday
  $$
  SELECT net.http_post(
    url := 'https://nlklndgmtmwoacipjyek.supabase.co/functions/v1/weekly-insights',
    headers := jsonb_build_object(
      'Authorization', 'Bearer YOUR_PUBLISHABLE_KEY_HERE',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
