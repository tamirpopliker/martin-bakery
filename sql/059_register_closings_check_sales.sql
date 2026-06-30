-- 059_register_closings_check_sales.sql
-- Add check_sales (שיק) column to register_closings — third revenue bucket
-- alongside cash_sales and credit_sales. Matches CashOnTab POS report layout
-- (column M) so reconciliation can compare apples to apples.
-- Stored NET (after VAT division), consistent with cash_sales / credit_sales.

ALTER TABLE register_closings
  ADD COLUMN IF NOT EXISTS check_sales NUMERIC NOT NULL DEFAULT 0;
