import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(50050),
  DATABASE_URL: z.string().url(),
  API_SECRET_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  PUBLIC_BASE_URL: z.string().default('http://localhost:50050'),
  // WhatsApp transport: 'chakra' = ChakraHQ (BSP pass-through over Meta's Cloud API),
  // 'meta' = Meta Cloud API direct.
  WHATSAPP_TRANSPORT: z.enum(['meta', 'chakra']).default('chakra'),
  // Meta WhatsApp Cloud API (empty defaults so chakra-only deploys still boot;
  // the webhook rejects requests when the relevant value is empty)
  META_WEBHOOK_VERIFY_TOKEN: z.string().default(''),
  META_WEBHOOK_SECRET: z.string().default(''),
  META_ACCESS_TOKEN: z.string().default(''),
  META_API_VERSION: z.string().default('v19.0'),
  // ChakraHQ (used when WHATSAPP_TRANSPORT=chakra). Pass-through proxy over Meta's
  // Cloud API — same payloads, different base URL/token and inbound HMAC header.
  CHAKRA_BASE_URL: z.string().default('https://api.chakrahq.com'),
  CHAKRA_PLUGIN_ID: z.string().default(''),
  CHAKRA_API_VERSION: z.string().default('v22.0'),
  CHAKRA_ACCESS_TOKEN: z.string().default(''),
  CHAKRA_WEBHOOK_SECRET: z.string().default(''),
  // How often to backfill conversation history from Chakra. 0 disables the timer (the
  // dashboard button still works). Default hourly.
  CHAKRA_SYNC_INTERVAL_MS: z.coerce.number().int().min(0).default(3_600_000),
  // ─── Staff notification ──────────────────────────────────────────────────
  // Until these are set, an escalation reaches a human only if someone happens to have the
  // dashboard open: escalateConversation messages the CUSTOMER, and the escalations queue is
  // polled, not pushed. Every knob below is optional and inert when empty, so a deploy that
  // sets none of them behaves exactly as before.
  //
  // Generate the VAPID pair once, on any machine: npx web-push generate-vapid-keys
  // Rotating it invalidates every existing subscription - staff must re-enable notifications.
  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  // RFC 8292: a contact the push service can reach if our sends start misbehaving.
  VAPID_SUBJECT: z.string().default('mailto:you@example.com'),
  // Staff WhatsApp number pinged on escalation. Covers phones with no push subscription (iOS
  // before 16.4, or a browser where nobody pressed "Aktifkan notifikasi") and doubles as the
  // fallback when a subscription has silently expired. Empty = off.
  ESCALATION_NOTIFY_WA: z.string().default(''),
  // How long an escalation may sit before staff are nudged again, and how often to look.
  // 0 on either disables the nudge entirely. Default: remind after 30 min, check every 10.
  ESCALATION_NUDGE_AFTER_MS: z.coerce.number().int().min(0).default(1_800_000),
  ESCALATION_NUDGE_INTERVAL_MS: z.coerce.number().int().min(0).default(600_000),
  // ─── Reset command ───────────────────────────────────────────────────────
  // Comma-separated WhatsApp numbers allowed to type /new, which wipes THEIR OWN thread's AI
  // memory and CRM state (contact profile, lead status). Empty - the default - disables the
  // command entirely, so a customer who types "/new" just sends an ordinary message. Matching
  // is digits-only, so +62 812-3456 and 628123456 are the same number. This is a testing knob:
  // anyone holding a listed handset can destroy that contact's profile and lead status.
  RESET_COMMAND_NUMBERS: z.string().default(''),
  // SKIP_HMAC_IN_DEV is read ad-hoc via process.env (dev-only signature bypass)
});

export type Config = z.infer<typeof envSchema>;

let _config: Config | null = null;

export function getConfig(): Config {
  if (_config) return _config;

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  _config = result.data;
  return _config;
}
