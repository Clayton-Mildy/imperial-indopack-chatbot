-- Lead source tracking. One row per lead: request_id set = the customer came through a
-- marketing form (their prefilled WhatsApp template carries "Request ID: <uuid>", which
-- messageRouter parses out and matches here); request_id null = an organic walk-in, which
-- is ~96% of current traffic and the baseline every campaign is measured against.
--
-- The two partial unique indexes are the concurrency story: request_id is unique among
-- campaign leads, contact_id is unique among organic ones, and both are ON CONFLICT
-- targets so the Excel import and the WhatsApp match can land in either order.
--
-- Pure DDL against a brand new table - nothing here can fail on existing prod data.
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid,
	"contact_id" uuid,
	"utm_id" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_term" text,
	"utm_content" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"deal_value_idr" numeric,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"matched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_leads_request_id" ON "leads" USING btree ("request_id") WHERE "leads"."request_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_leads_organic_contact" ON "leads" USING btree ("contact_id") WHERE "leads"."request_id" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_leads_campaign" ON "leads" USING btree ("utm_campaign");--> statement-breakpoint
CREATE INDEX "idx_leads_submitted" ON "leads" USING btree ("submitted_at");