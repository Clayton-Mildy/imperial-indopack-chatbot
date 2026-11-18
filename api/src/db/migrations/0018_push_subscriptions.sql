-- Web-push subscriptions, one row per browser a staff member enabled notifications in.
--
-- Until now nothing in this system notified a human of an escalation: escalateConversation's
-- third argument is the CUSTOMER's WhatsApp id, so the "escalation notification" was a canned
-- line back to the customer, and the only staff-facing surface was a badge polled by an open
-- dashboard tab. This table is what lets a phone ring.
--
-- endpoint is the identity - it is the URL the push service is addressed at - so it carries the
-- unique constraint and a re-subscribe from the same browser upserts rather than duplicating.
-- Rows are disposable: a 404/410 from the push service means the subscription is dead and
-- pushNotify deletes it. ON DELETE cascade because a removed staff member's phone must stop
-- receiving customer data.
--
-- Pure DDL against a brand new table - nothing here can fail on existing prod data.
CREATE TABLE "staff_push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
ALTER TABLE "staff_push_subscriptions" ADD CONSTRAINT "staff_push_subscriptions_staff_id_staff_profiles_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_profiles"("id") ON DELETE cascade ON UPDATE no action;