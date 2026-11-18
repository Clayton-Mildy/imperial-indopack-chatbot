ALTER TABLE "leads" ADD COLUMN "lead_temperature" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "total_orders" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "human_updated_at" timestamp with time zone;