-- 061_document_types_numeric_value.sql
-- Some monthly events aren't a file — they're a data point (e.g. "פדיון X ימי חופש").
-- Adds a numeric field to document_types + employee_documents so those events can
-- be logged without a file attachment.

ALTER TABLE document_types ADD COLUMN IF NOT EXISTS requires_numeric_value BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE document_types ADD COLUMN IF NOT EXISTS numeric_value_label TEXT;

ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS numeric_value NUMERIC;

-- Legacy rows still have file_name / file_url NOT NULL. Loosen so file-less
-- events (numeric-only) can be inserted.
ALTER TABLE employee_documents ALTER COLUMN file_name DROP NOT NULL;
ALTER TABLE employee_documents ALTER COLUMN file_url  DROP NOT NULL;

-- Insert the "פדיון ימי חופש" event type. If it already exists (repeated runs),
-- update the metadata but keep the existing id/history intact.
INSERT INTO document_types (key, label_he, is_default, display_order, is_monthly_event, requires_numeric_value, numeric_value_label)
VALUES ('vacation_redemption', 'פדיון ימי חופש', false, 100, true, true, 'ימי חופש')
ON CONFLICT (key) DO UPDATE
  SET is_monthly_event      = EXCLUDED.is_monthly_event,
      requires_numeric_value = EXCLUDED.requires_numeric_value,
      numeric_value_label    = EXCLUDED.numeric_value_label;
