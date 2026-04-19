-- Add 'delivered_to_customer' status: branch has handed the cake to the customer.
ALTER TABLE special_orders DROP CONSTRAINT IF EXISTS special_orders_status_check;
ALTER TABLE special_orders ADD CONSTRAINT special_orders_status_check
  CHECK (status IN ('new', 'in_progress', 'sent_to_branch', 'delivered_to_customer', 'cancelled'));
