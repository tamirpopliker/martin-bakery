-- Simplify special_orders for internal use:
--   - Add manually-entered order number (the previous order_number is kept as a system unique key)
--   - Phone is no longer required by the form, so make the column nullable
--   - advance_payment and image_requested are no longer used by the form, but kept on the table
--     to preserve historical rows. New inserts simply omit them and the column defaults take over.
ALTER TABLE special_orders ADD COLUMN IF NOT EXISTS order_number_manual TEXT;
ALTER TABLE special_orders ALTER COLUMN customer_phone DROP NOT NULL;
