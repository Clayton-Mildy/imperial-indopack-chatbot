ALTER TABLE "product_variants" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "scraped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "source_hash" text;
