import { apiFetch } from "./client";
import type { BotSettings, GoLiveIssue, PoFormKind, PoFormSetting, PoFormsSetting, PromptSection, WhatsAppStatus } from "@/types/api";

export async function getPromptDefaults(): Promise<PromptSection[]> {
  try {
    const envelope = await apiFetch<PromptSection[]>("/settings/prompt-defaults");
    return envelope.data ?? [];
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 501 || status === 404 || status === 405) {
      console.warn("[settings] prompt-defaults endpoint not yet implemented (status:", status, ")");
      return [];
    }
    throw err;
  }
}

/** The lost-lead return window in months (the API stores days, x 30). */
export async function getLeadReopenMonths(): Promise<number> {
  const envelope = await apiFetch<{ months: number }>("/settings/lead-reopen-months");
  const months = envelope.data?.months;
  if (typeof months !== "number" || !Number.isInteger(months)) throw new Error("Malformed lead-reopen-months response");
  return months;
}

export async function setLeadReopenMonths(months: number): Promise<number> {
  const envelope = await apiFetch<{ months: number }>("/settings/lead-reopen-months", {
    method: "PATCH",
    body: JSON.stringify({ months }),
  });
  return envelope.data?.months ?? months;
}

export async function getLeadSilenceDays(): Promise<number> {
  const envelope = await apiFetch<{ days: number }>("/settings/lead-silence-days");
  const days = envelope.data?.days;
  if (typeof days !== "number" || !Number.isInteger(days)) throw new Error("Malformed lead-silence-days response");
  return days;
}

export async function setLeadSilenceDays(days: number): Promise<number> {
  const envelope = await apiFetch<{ days: number }>("/settings/lead-silence-days", {
    method: "PATCH",
    body: JSON.stringify({ days }),
  });
  return envelope.data?.days ?? days;
}

export async function patchPromptDefaults(sections: PromptSection[]): Promise<void> {
  await apiFetch("/settings/prompt-defaults", {
    method: "PATCH",
    body: JSON.stringify({ sections }),
  });
}

/** One form of the po-forms response; a malformed one throws. Anything but an explicit false is the placeholder. */
function poFormOf(raw: unknown): PoFormSetting {
  const d = raw as Partial<PoFormSetting> | null | undefined;
  if (!d || typeof d.url !== "string" || typeof d.message !== "string") throw new Error("Malformed po-forms response");
  return { url: d.url, isPlaceholder: d.isPlaceholder !== false, message: d.message };
}

/** Both PO forms (cetak, plano): each link, whether it is still the placeholder, and the exact message a send would carry. */
export async function getPoFormsSetting(): Promise<PoFormsSetting> {
  const envelope = await apiFetch<PoFormsSetting>("/settings/po-forms");
  const d = envelope.data;
  if (!d || typeof d.both?.message !== "string") throw new Error("Malformed po-forms response");
  return { cetak: poFormOf(d.cetak), plano: poFormOf(d.plano), both: { message: d.both.message } };
}

/** Sets one form's link (https only - the API answers 400 otherwise) and returns both forms as now stored. */
export async function setPoFormUrl(kind: PoFormKind, url: string): Promise<PoFormsSetting> {
  const envelope = await apiFetch<PoFormsSetting>("/settings/po-forms", {
    method: "PATCH",
    body: JSON.stringify({ kind, url }),
  });
  const d = envelope.data;
  if (!d || typeof d.both?.message !== "string") throw new Error("Malformed po-forms response");
  return { cetak: poFormOf(d.cetak), plano: poFormOf(d.plano), both: { message: d.both.message } };
}

/** Bot name, signature, greeting, fallback minimum and the two intervals (api/src/domain/botSettings.ts). */
export async function getBotSettings(): Promise<BotSettings> {
  const envelope = await apiFetch<BotSettings>("/settings/bot");
  if (!envelope.data) throw new Error("Malformed bot settings response");
  return envelope.data;
}

/** Merges the given fields; the API answers 400 for a field out of range. Returns the stored settings. */
export async function patchBotSettings(patch: Partial<BotSettings>): Promise<BotSettings> {
  const envelope = await apiFetch<BotSettings>("/settings/bot", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  if (!envelope.data) throw new Error("Malformed bot settings response");
  return envelope.data;
}

export async function getWhatsAppStatus(): Promise<WhatsAppStatus> {
  const envelope = await apiFetch<WhatsAppStatus>("/settings/whatsapp-status");
  if (!envelope.data) throw new Error("Malformed whatsapp-status response");
  return envelope.data;
}

/** What still blocks go-live, in the API's order. */
export async function getGoLiveIssues(): Promise<GoLiveIssue[]> {
  const envelope = await apiFetch<{ issues: GoLiveIssue[] }>("/settings/go-live");
  const issues = envelope.data?.issues;
  if (!Array.isArray(issues)) throw new Error("Malformed go-live response");
  return issues;
}
