-- Staff edited a lead's brands or items by hand: the AI lead pass stops merging into them,
-- the same lock the deal value and order count already have (0025). /new clears it.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS order_fields_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS order_fields_set_by uuid REFERENCES staff_profiles(id) ON DELETE SET NULL;
