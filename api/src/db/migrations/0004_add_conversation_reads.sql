CREATE TABLE IF NOT EXISTS "conversation_reads" (
	"conversation_id" uuid NOT NULL,
	"agent_id" text NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_conversation_reads_conv_agent" UNIQUE("conversation_id","agent_id")
);
--> statement-breakpoint
ALTER TABLE "conversation_reads" ADD CONSTRAINT "conversation_reads_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
