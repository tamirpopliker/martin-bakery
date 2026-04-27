-- Migration 031: hq_estimate_pct setting
-- Adds the headquarters-allocation estimate percentage used when
-- employer_costs is_headquarters rows haven't been uploaded yet for a month.
-- Mirrors the labor pattern: estimate now, replace with actual on upload.
--
-- When actual HQ data exists for a given month, calculatePL allocates the
-- real HQ cost across entities by external-revenue share. When it doesn't,
-- each entity is charged this percentage of its external revenue.

INSERT INTO system_settings (key, value)
VALUES ('hq_estimate_pct', '10')
ON CONFLICT (key) DO NOTHING;
