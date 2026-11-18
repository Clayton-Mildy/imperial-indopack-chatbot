-- Backfill migration: the catalog restructure (catalog_items -> products/uom/
-- brands/product_variants, plus app_settings/activity_logs and a few columns)
-- was historically applied with `drizzle-kit push` and never captured as a
-- migration, so migrations 0003+ failed on any fresh database. This file
-- recreates that state as it existed just before 0003; later migrations
-- (0003, 0006-0013) still apply their own columns on top. Every statement is
-- guarded so it is a no-op on databases that already got this via push.

CREATE TABLE IF NOT EXISTS "uom" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uom_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"catalog_file_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brands_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL REFERENCES "brands"("id") ON DELETE cascade,
	"name" text NOT NULL,
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_products_brand" ON "products" ("brand_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE cascade,
	"name" text NOT NULL,
	"sku" text,
	"price_idr" numeric,
	"isi_ctn" integer,
	"isi_box" integer,
	"uom_price_id" uuid REFERENCES "uom"("id"),
	"uom_ctn_id" uuid REFERENCES "uom"("id"),
	"uom_box_id" uuid REFERENCES "uom"("id"),
	"image_url" text,
	"stock_status" text DEFAULT 'normal' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_variants_product" ON "product_variants" ("product_id","is_active");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_variant_name_per_product" ON "product_variants" ("product_id","name");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "activity_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message" text NOT NULL,
	"performed_by" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_activity_logs_created" ON "activity_logs" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_activity_logs_entity" ON "activity_logs" ("entity_type","entity_id");
--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD COLUMN IF NOT EXISTS "meta_access_token" text;
--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD COLUMN IF NOT EXISTS "prompt_sections" jsonb;
--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "catalog_audit" DROP CONSTRAINT IF EXISTS "catalog_audit_item_id_catalog_items_id_fk";
--> statement-breakpoint
DROP TABLE IF EXISTS "catalog_items";
