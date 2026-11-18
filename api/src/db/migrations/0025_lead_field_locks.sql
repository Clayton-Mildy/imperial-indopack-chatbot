-- Per-field staff locks, and orders counted from the chat (client 2026-11-10: "bot auto fill it, but
-- for every thing manually changed, don't let the bot change it, and show a mark that someone did").
-- human_updated_at used to lock status, order count and deal value together; it now locks status
-- only, and the two numbers get a lock of their own. Each records who set it, for the mark.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS status_set_by uuid REFERENCES staff_profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE leads ADD COLUMN IF NOT EXISTS total_orders_set_at timestamptz;
--> statement-breakpoint
ALTER TABLE leads ADD COLUMN IF NOT EXISTS total_orders_set_by uuid REFERENCES staff_profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE leads ADD COLUMN IF NOT EXISTS deal_value_set_at timestamptz;
--> statement-breakpoint
ALTER TABLE leads ADD COLUMN IF NOT EXISTS deal_value_set_by uuid REFERENCES staff_profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
-- A lock set before the split covered all three fields: keep it on all three.
UPDATE leads SET total_orders_set_at = human_updated_at, deal_value_set_at = human_updated_at
WHERE human_updated_at IS NOT NULL;
--> statement-breakpoint
-- One row per customer message that placed an order, written by the lead-insights pass with that
-- message as evidence. leads.total_orders is their count while staff have not set it by hand.
CREATE TABLE IF NOT EXISTS lead_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  evidence text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_orders_message ON lead_orders (lead_id, message_id);
