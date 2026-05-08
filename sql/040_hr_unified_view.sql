-- 040_hr_unified_view.sql
-- Unified read-only view for the HR dashboard. UNION of branch_employees + employees.
-- security_invoker=true makes it honor the underlying tables' RLS (PG 15+).

CREATE OR REPLACE VIEW hr_employees_unified
  WITH (security_invoker = true)
AS
SELECT
  'branch'::text                 AS kind,
  be.id::bigint                  AS id,
  be.name                        AS name,
  be.email                       AS email,
  be.phone                       AS phone,
  be.position                    AS position,
  b.name                         AS location_name,
  be.branch_id                   AS branch_id,
  be.department                  AS department,
  be.hourly_rate                 AS hourly_rate,
  NULL::numeric                  AS global_daily_rate,
  be.monthly_salary              AS monthly_salary,
  be.retention_bonus             AS retention_bonus,
  be.start_date                  AS start_date,
  be.end_date                    AS end_date,
  be.active                      AS active,
  be.is_manager                  AS is_manager,
  be.id_number                   AS id_number,
  be.birth_date                  AS birth_date,
  be.photo_url                   AS photo_url
FROM branch_employees be
LEFT JOIN branches b ON b.id = be.branch_id
UNION ALL
SELECT
  'factory'::text                AS kind,
  e.id::bigint                   AS id,
  e.name                         AS name,
  e.email                        AS email,
  e.phone                        AS phone,
  e.position                     AS position,
  'מפעל'::text                   AS location_name,
  NULL::int                      AS branch_id,
  e.department                   AS department,
  e.hourly_rate                  AS hourly_rate,
  e.global_daily_rate            AS global_daily_rate,
  e.monthly_salary               AS monthly_salary,
  e.retention_bonus              AS retention_bonus,
  e.start_date                   AS start_date,
  e.end_date                     AS end_date,
  e.active                       AS active,
  NULL::boolean                  AS is_manager,
  e.id_number                    AS id_number,
  e.birth_date                   AS birth_date,
  e.photo_url                    AS photo_url
FROM employees e;
