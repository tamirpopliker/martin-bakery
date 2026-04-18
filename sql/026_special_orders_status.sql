-- Collapse special_orders lifecycle to 3 states (+ cancelled):
--   new            — order received from branch
--   in_progress    — factory picked it up / started working on it
--   sent_to_branch — sent to the branch
-- Existing rows with confirmed/in_production/ready migrate to 'in_progress'; delivered → 'sent_to_branch'.
ALTER TABLE special_orders DROP CONSTRAINT IF EXISTS special_orders_status_check;

UPDATE special_orders SET status = 'in_progress'
  WHERE status IN ('confirmed', 'in_production', 'ready');
UPDATE special_orders SET status = 'sent_to_branch'
  WHERE status = 'delivered';

ALTER TABLE special_orders ADD CONSTRAINT special_orders_status_check
  CHECK (status IN ('new', 'in_progress', 'sent_to_branch', 'cancelled'));
