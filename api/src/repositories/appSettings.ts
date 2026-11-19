import { getDb } from '../db/client.js';
import { appSettings } from '../db/schema.js';
import { eq, inArray } from 'drizzle-orm';
import type { PromptSections } from '../domain/types.js';
import { SYSTEM_PROMPT_SECTIONS, PO_FORM_PLACEHOLDER_URL, isPoFormPlaceholder } from '../domain/constants.js';
import { BotSettingsPatchSchema, DEFAULT_BOT_SETTINGS, type BotSettings } from '../domain/botSettings.js';
import { PO_FORM_KINDS, type PoFormKind } from '../domain/poForms.js';

const DEFAULT_PROMPT_SECTIONS_KEY = 'default_prompt_sections';
const AI_ENABLED_DEFAULT_KEY = 'ai_enabled_default';
const CHAKRA_SYNC_STATE_KEY = 'chakra_sync_state';
// What reseed-prompt-defaults last shipped, per section name - see promptSync.syncPromptSections.
const SHIPPED_PROMPT_SECTIONS_KEY = 'shipped_prompt_sections';

/**
 * Global auto-reply switch. Contacts with contacts.ai_enabled = NULL follow it.
 * Absent row means true, so an upgrade doesn't silently mute the bot.
 */
export async function getAiEnabledDefault(): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, AI_ENABLED_DEFAULT_KEY))
    .limit(1);
  return row ? row.value === true : true;
}

export async function setAiEnabledDefault(aiEnabled: boolean): Promise<void> {
  const db = getDb();
  await db
    .insert(appSettings)
    .values({ key: AI_ENABLED_DEFAULT_KEY, value: aiEnabled })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: aiEnabled, updatedAt: new Date() },
    });
}

const LEAD_REOPEN_AFTER_DAYS_KEY = 'lead_reopen_after_days';
const DEFAULT_LEAD_REOPEN_AFTER_DAYS = 90;

/**
 * How long after a lead was Lost the same lead is reopened when the customer writes again;
 * after that a new lead is opened instead. Absent or unusable row means 90.
 */
export async function getLeadReopenAfterDays(): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, LEAD_REOPEN_AFTER_DAYS_KEY))
    .limit(1);
  const v = row?.value;
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 365
    ? v
    : DEFAULT_LEAD_REOPEN_AFTER_DAYS;
}

export async function setLeadReopenAfterDays(days: number): Promise<void> {
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error('lead_reopen_after_days must be an integer from 1 to 365');
  }
  const db = getDb();
  await db
    .insert(appSettings)
    .values({ key: LEAD_REOPEN_AFTER_DAYS_KEY, value: days })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: days, updatedAt: new Date() },
    });
}

const LEAD_SILENCE_LOST_DAYS_KEY = 'lead_silence_lost_days';
const DEFAULT_LEAD_SILENCE_LOST_DAYS = 30;

/**
 * How many days a lead may go without a customer reply to our last message before it is closed as
 * Lost, reason tidak_ada_respon (client, 2026-11-13: no response within the threshold is Lost). See
 * closeSilentLeads. Absent or unusable row means 30 (client, 2026-11-13: "1 month").
 */
export async function getLeadSilenceLostDays(): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, LEAD_SILENCE_LOST_DAYS_KEY))
    .limit(1);
  const v = row?.value;
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 365
    ? v
    : DEFAULT_LEAD_SILENCE_LOST_DAYS;
}

export async function setLeadSilenceLostDays(days: number): Promise<void> {
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error('lead_silence_lost_days must be an integer from 1 to 365');
  }
  const db = getDb();
  await db
    .insert(appSettings)
    .values({ key: LEAD_SILENCE_LOST_DAYS_KEY, value: days })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: days, updatedAt: new Date() },
    });
}

/** One link per form (domain/poForms.ts): cetak with a design, plano without. */
const PO_FORM_URL_KEYS: Record<PoFormKind, string> = { cetak: 'po_form_url_cetak', plano: 'po_form_url_plano' };
/** The single link of before Task 20b - read as cetak until cetak itself is set. */
const LEGACY_PO_FORM_URL_KEY = 'po_form_url';
/** Until staff set the real Google Forms in Settings. Defined with the other fixed texts, as is the check. */
export { PO_FORM_PLACEHOLDER_URL, isPoFormPlaceholder };

/** The trimmed value when it is an https URL with a host, else null. */
function httpsUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const url = raw.trim();
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname ? url : null;
  } catch {
    return null;
  }
}

/**
 * The two PO form links the bot and quick-send send (messageRouter, send_po_form; poFormsForOrder picks
 * which). An absent or unusable row is the placeholder - except cetak, which falls back to the old
 * single link while that is a real one (it was the form in use before there were two).
 */
export async function getPoFormUrls(): Promise<Record<PoFormKind, string>> {
  const db = getDb();
  const rows = await db
    .select()
    .from(appSettings)
    .where(inArray(appSettings.key, [...Object.values(PO_FORM_URL_KEYS), LEGACY_PO_FORM_URL_KEY]));
  const stored = (key: string) => httpsUrl(rows.find((r) => r.key === key)?.value);
  const legacy = stored(LEGACY_PO_FORM_URL_KEY);
  return {
    cetak: stored(PO_FORM_URL_KEYS.cetak) ?? (legacy && !isPoFormPlaceholder(legacy) ? legacy : PO_FORM_PLACEHOLDER_URL),
    plano: stored(PO_FORM_URL_KEYS.plano) ?? PO_FORM_PLACEHOLDER_URL,
  };
}

/** https only: the link goes to customers as it is. */
export async function setPoFormUrl(kind: PoFormKind, url: string): Promise<void> {
  if (!PO_FORM_KINDS.includes(kind)) throw new Error(`unknown PO form "${String(kind)}"`);
  const value = httpsUrl(url);
  if (!value) throw new Error(`${PO_FORM_URL_KEYS[kind]} must be an https URL`);
  const db = getDb();
  await db
    .insert(appSettings)
    .values({ key: PO_FORM_URL_KEYS[kind], value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
    });
}

/**
 * Where the ChakraHQ history sync got to. watermarkMs is the newest chat.updatedAt seen;
 * the next run stops paging once it drops below it, so re-runs are cheap.
 */
export interface ChakraSyncResult {
  chats: number;
  messages: number;
  mediaFailed: number;
  errors: number;
  /** Cut short by maxChats — the watermark is deliberately not advanced when this is set. */
  truncated: boolean;
}

export interface ChakraSyncState {
  watermarkMs: number;
  lastRunAt: string | null;
  lastResult: ChakraSyncResult | null;
}

const EMPTY_SYNC_STATE: ChakraSyncState = { watermarkMs: 0, lastRunAt: null, lastResult: null };

export async function getChakraSyncState(): Promise<ChakraSyncState> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, CHAKRA_SYNC_STATE_KEY))
    .limit(1);
  return row ? { ...EMPTY_SYNC_STATE, ...(row.value as Partial<ChakraSyncState>) } : EMPTY_SYNC_STATE;
}

export async function setChakraSyncState(state: ChakraSyncState): Promise<void> {
  const db = getDb();
  await db
    .insert(appSettings)
    .values({ key: CHAKRA_SYNC_STATE_KEY, value: state })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: state, updatedAt: new Date() },
    });
}

export async function getDefaultPromptSections(): Promise<PromptSections> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, DEFAULT_PROMPT_SECTIONS_KEY))
    .limit(1);
  if (!row) return getHardcodedDefaultSections();
  return row.value as PromptSections;
}

export async function setDefaultPromptSections(sections: PromptSections): Promise<void> {
  const db = getDb();
  await db
    .insert(appSettings)
    .values({ key: DEFAULT_PROMPT_SECTIONS_KEY, value: sections })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: sections, updatedAt: new Date() },
    });
}

function getHardcodedDefaultSections(): PromptSections {
  return SYSTEM_PROMPT_SECTIONS;
}

export async function getShippedPromptSections(): Promise<Record<string, string>> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, SHIPPED_PROMPT_SECTIONS_KEY))
    .limit(1);
  return row ? (row.value as Record<string, string>) : {};
}

export async function setShippedPromptSections(sections: Record<string, string>): Promise<void> {
  const db = getDb();
  await db
    .insert(appSettings)
    .values({ key: SHIPPED_PROMPT_SECTIONS_KEY, value: sections })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: sections, updatedAt: new Date() },
    });
}

const BOT_SETTINGS_KEY = 'bot_settings';

/**
 * Bot name, signature, first greeting, fallback minimum order and the two background-job
 * intervals. A missing row, or a field that fails validation, falls back to its own default.
 * Read fresh on every call, like the other settings.
 */
export async function getBotSettings(): Promise<BotSettings> {
  const db = getDb();
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, BOT_SETTINGS_KEY)).limit(1);
  const stored = row?.value && typeof row.value === 'object' ? (row.value as Record<string, unknown>) : {};
  const out: Record<string, unknown> = { ...DEFAULT_BOT_SETTINGS };
  for (const [key, schema] of Object.entries(BotSettingsPatchSchema.shape)) {
    const parsed = schema.safeParse(stored[key]);
    if (parsed.success && parsed.data !== undefined) out[key] = parsed.data;
  }
  return out as unknown as BotSettings;
}

/** Merges the given fields into the stored row. Throws ZodError on bad input. */
export async function patchBotSettings(patch: unknown): Promise<BotSettings> {
  const fields = BotSettingsPatchSchema.parse(patch);
  const merged = { ...(await getBotSettings()), ...fields };
  const db = getDb();
  await db
    .insert(appSettings)
    .values({ key: BOT_SETTINGS_KEY, value: merged })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: merged, updatedAt: new Date() } });
  return merged;
}
