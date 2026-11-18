-- The product editor (Plan 2 Task 6). A product can be switched off without deleting it: the bot stops
-- offering it on the next turn, its data and history stay. Each brand remembers its price-list file's
-- name and upload time. catalog_audit keeps the actor's name, so a row still reads after the staff
-- account is gone (changed_by falls to NULL then), and is read newest first per product.
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE brands ADD COLUMN IF NOT EXISTS catalog_file_name text, ADD COLUMN IF NOT EXISTS catalog_file_uploaded_at timestamptz;
--> statement-breakpoint
ALTER TABLE catalog_audit ADD COLUMN IF NOT EXISTS actor_name text;
--> statement-breakpoint
ALTER TABLE catalog_audit DROP CONSTRAINT IF EXISTS catalog_audit_changed_by_staff_profiles_id_fk;
--> statement-breakpoint
ALTER TABLE catalog_audit ADD CONSTRAINT catalog_audit_changed_by_staff_profiles_id_fk FOREIGN KEY (changed_by) REFERENCES staff_profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_catalog_audit_item ON catalog_audit (item_id, changed_at DESC);
