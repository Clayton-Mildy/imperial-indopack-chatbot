-- AI auto-reply switches. The global default moves out of phone_numbers into
-- app_settings (key 'ai_enabled_default'), so it is one switch for the whole bot
-- rather than one per WhatsApp number. contacts.ai_enabled is a nullable
-- per-contact override: NULL follows the global default, TRUE/FALSE pins that
-- contact either way.
ALTER TABLE "contacts" ADD COLUMN "ai_enabled" boolean;--> statement-breakpoint
ALTER TABLE "phone_numbers" DROP COLUMN "ai_enabled";