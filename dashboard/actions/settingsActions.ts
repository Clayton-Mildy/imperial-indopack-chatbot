"use server";

import { revalidatePath } from "next/cache";
import { apiFetch, ApiError } from "@/lib/api/client";
import { createLog } from "@/lib/api/activityLogs";
import type { BotSettings, PoFormKind, PoFormsSetting, PromptSection, ChakraSyncStatus } from "@/types/api";
import { sessionRole, sessionStaff } from "@/lib/session";
import { patchBotSettings, setLeadReopenMonths, setLeadSilenceDays, setPoFormUrl } from "@/lib/api/settings";
import { getNumbers, patchNumber } from "@/lib/api/numbers";
import { validatePoUrl } from "@/lib/settings";

// Every write here is admin only, re-checked on the server: a "use server" action is a POST endpoint
// any signed-in session can call, whatever the page shows. Who made the change comes from the
// session, never the browser.

export type SaveError = "forbidden" | "invalid" | "failed";

async function isAdmin(): Promise<boolean> {
  return (await sessionRole()) === "admin";
}

/** Fire-and-forget activity log line in the admin's name. */
async function logSetting(message: (name: string) => string, entityId: string, entityType = "settings"): Promise<void> {
  const { staffName } = await sessionStaff();
  createLog({ message: message(staffName), performedBy: staffName, entityType, entityId }).catch(() => {});
}

const isWhole = (n: unknown, min: number, max: number): n is number => Number.isInteger(n) && (n as number) >= min && (n as number) <= max;

/** The same ranges as api/src/domain/botSettings.ts BotSettingsPatchSchema, so a bad value never leaves the dashboard. */
const BOT_FIELD_OK: { [K in keyof BotSettings]: (v: unknown) => boolean } = {
  botName: (v) => typeof v === "string" && v.trim().length >= 1 && v.trim().length <= 40,
  signAs: (v) => v === "brand_discussed" || v === "imperial_indopack",
  greeting: (v) => typeof v === "string" && v.trim().length >= 1 && v.trim().length <= 500,
  fallbackMinPcs: (v) => isWhole(v, 1, 1_000_000),
  teamReminderMinutes: (v) => isWhole(v, 5, 1440),
  whatsappSyncMinutes: (v) => isWhole(v, 0, 1440),
};

/** For the activity log: what each field is called on the page. */
const BOT_FIELD_NAME: Record<keyof BotSettings, string> = {
  botName: "nama bot",
  signAs: "menyebut diri dari",
  greeting: "sapaan pertama",
  fallbackMinPcs: "minimum order",
  teamReminderMinutes: "pengingat Perlu Tim",
  whatsappSyncMinutes: "jadwal ambil balasan dari HP",
};

/** Saves some of the bot settings (Bot, minimum order, reminder, sync interval). Text fields are trimmed. */
export async function saveBotSettingsAction(
  patch: Partial<BotSettings>,
): Promise<{ ok: true; settings: BotSettings } | { ok: false; error: SaveError }> {
  if (!(await isAdmin())) return { ok: false, error: "forbidden" };
  const fields = Object.keys(patch ?? {}) as (keyof BotSettings)[];
  if (fields.length === 0 || fields.some((k) => !Object.hasOwn(BOT_FIELD_OK, k) || !BOT_FIELD_OK[k](patch[k]))) {
    return { ok: false, error: "invalid" };
  }
  const clean = Object.fromEntries(fields.map((k) => [k, typeof patch[k] === "string" ? (patch[k] as string).trim() : patch[k]])) as Partial<BotSettings>;
  let settings: BotSettings;
  try {
    settings = await patchBotSettings(clean);
  } catch (err) {
    return { ok: false, error: err instanceof ApiError && err.status === 400 ? "invalid" : "failed" };
  }
  revalidatePath("/settings");
  await logSetting((n) => `${n} mengubah pengaturan bot: ${fields.map((k) => BOT_FIELD_NAME[k]).join(", ")}`, "bot_settings");
  return { ok: true, settings };
}

/**
 * Sets one PO form's link (cetak: the customer has a design; plano: no design). Checked with
 * validatePoUrl before anything is sent; answers with both forms as now stored, so the page shows the
 * message a send would carry.
 */
export async function savePoFormUrlAction(
  kind: PoFormKind,
  url: string,
): Promise<{ ok: true; forms: PoFormsSetting } | { ok: false; error: "forbidden" | "not_https" | "invalid" | "failed" }> {
  if (!(await isAdmin())) return { ok: false, error: "forbidden" };
  if (kind !== "cetak" && kind !== "plano") return { ok: false, error: "invalid" };
  const check = validatePoUrl(typeof url === "string" ? url : "");
  if (check !== "ok") return { ok: false, error: check };
  let forms: PoFormsSetting;
  try {
    forms = await setPoFormUrl(kind, url.trim());
  } catch (err) {
    return { ok: false, error: err instanceof ApiError && err.status === 400 ? "invalid" : "failed" };
  }
  revalidatePath("/settings");
  await logSetting((n) => `${n} mengubah link form order ${kind}`, `po_form_url_${kind}`);
  return { ok: true, forms };
}

/** How many months after a lead was lost the same lead is reopened (1-12). */
export async function saveReopenMonthsAction(months: number): Promise<{ ok: true; months: number } | { ok: false; error: SaveError }> {
  if (!(await isAdmin())) return { ok: false, error: "forbidden" };
  if (!isWhole(months, 1, 12)) return { ok: false, error: "invalid" };
  let saved: number;
  try {
    saved = await setLeadReopenMonths(months);
  } catch (err) {
    return { ok: false, error: err instanceof ApiError && err.status === 400 ? "invalid" : "failed" };
  }
  revalidatePath("/settings");
  await logSetting((n) => `${n} mengubah batas lead kalah dibuka lagi menjadi ${saved} bulan`, "lead_reopen_after_days");
  return { ok: true, months: saved };
}

/** How many days without a customer reply before a lead is closed as Lost (1-365). */
export async function saveLeadSilenceDays(days: number): Promise<{ ok: true; days: number } | { ok: false; error: SaveError }> {
  if (!(await isAdmin())) return { ok: false, error: "forbidden" };
  if (!isWhole(days, 1, 365)) return { ok: false, error: "invalid" };
  let saved: number;
  try {
    saved = await setLeadSilenceDays(days);
  } catch (err) {
    return { ok: false, error: err instanceof ApiError && err.status === 400 ? "invalid" : "failed" };
  }
  revalidatePath("/settings");
  await logSetting((n) => `${n} mengubah batas lead tanpa respon menjadi ${saved} hari`, "lead_silence_lost_days");
  return { ok: true, days: saved };
}

/**
 * Puts a number that has its own instruction sections on the shared ones (Instruksi bot): its own
 * sections are deleted for good - the page shows them read-only and asks first. Only a registered
 * number; the log names it.
 */
export async function replaceNumberPromptAction(numberId: string): Promise<{ ok: true } | { ok: false; error: SaveError }> {
  if (!(await isAdmin())) return { ok: false, error: "forbidden" };
  let label: string;
  try {
    const num = (await getNumbers()).find((n) => n.id === numberId);
    if (!num) return { ok: false, error: "invalid" };
    label = num.label ? `${num.label} (${num.number})` : num.number;
    await patchNumber(num.id, { promptSections: null });
  } catch (err) {
    return { ok: false, error: err instanceof ApiError && (err.status === 400 || err.status === 404) ? "invalid" : "failed" };
  }
  revalidatePath("/settings");
  await logSetting((n) => `${n} mengganti instruksi sendiri nomor ${label} dengan instruksi bersama (instruksi sendiri dihapus)`, numberId, "phoneNumber");
  return { ok: true };
}

/** Global auto-reply switch. Falls back to on if the API is unreachable. */
export async function getAiDefault(): Promise<boolean> {
  try {
    const envelope = await apiFetch<{ aiEnabled: boolean }>("/settings/ai-default");
    return envelope.data?.aiEnabled ?? true;
  } catch (err: unknown) {
    console.warn("[settings] Failed to fetch AI default:", err);
    return true;
  }
}

export async function setAiDefault(aiEnabled: boolean): Promise<{ ok: true } | { ok: false; error: "forbidden" | "failed" }> {
  if (!(await isAdmin())) return { ok: false, error: "forbidden" };
  try {
    await apiFetch("/settings/ai-default", {
      method: "PATCH",
      body: JSON.stringify({ aiEnabled: aiEnabled === true }),
    });
  } catch {
    return { ok: false, error: "failed" };
  }
  revalidatePath("/settings");
  await logSetting((n) => `${n} ${aiEnabled ? "mengaktifkan" : "menonaktifkan"} balasan otomatis AI untuk semua percakapan`, "ai_enabled_default");
  return { ok: true };
}

/** Last ChakraHQ history sync. Null when the API is unreachable — the card just hides the summary. */
export async function getChakraSyncStatus(): Promise<ChakraSyncStatus | null> {
  try {
    const envelope = await apiFetch<ChakraSyncStatus>("/chakra-sync/status");
    return envelope.data ?? null;
  } catch (err: unknown) {
    console.warn("[settings] Failed to fetch Chakra sync status:", err);
    return null;
  }
}

/**
 * Kicks off a history backfill. The API returns immediately — a first full run can take a
 * long time — so this reports "started", not "finished"; the summary fills in on reload.
 */
export async function runChakraSync(): Promise<{ ok: boolean; error?: string }> {
  if (!(await isAdmin())) return { ok: false, error: "Anda tidak memiliki izin untuk melakukan perubahan ini." };

  let started: boolean;
  try {
    const envelope = await apiFetch<{ started: boolean; reason?: string }>("/chakra-sync/run", {
      method: "POST",
      body: JSON.stringify({}),
    });
    started = envelope.data?.started ?? false;
    if (!started && envelope.data?.reason !== "already_running") {
      return { ok: false, error: "Sinkronisasi tidak dapat dijalankan. Periksa pengaturan ChakraHQ." };
    }
  } catch {
    return { ok: false, error: "Gagal menghubungi server. Silakan coba lagi." };
  }

  revalidatePath("/settings");
  if (started) await logSetting((n) => `${n} menjalankan sinkronisasi riwayat percakapan ChakraHQ`, "chakra_sync_state");
  return { ok: true };
}

/** Replaces the bot's instruction sections (the API takes the whole list; every section needs content). */
export async function savePromptDefaults(sections: PromptSection[]): Promise<{ ok: true } | { ok: false; error: SaveError }> {
  if (!(await isAdmin())) return { ok: false, error: "forbidden" };
  const valid =
    Array.isArray(sections) &&
    sections.length > 0 &&
    sections.every((s) => typeof s?.name === "string" && s.name.trim() !== "" && typeof s.content === "string" && s.content.trim() !== "");
  if (!valid) return { ok: false, error: "invalid" };
  try {
    await apiFetch("/settings/prompt-defaults", {
      method: "PATCH",
      body: JSON.stringify({ sections: sections.map((s) => ({ name: s.name, content: s.content })) }),
    });
  } catch (err) {
    return { ok: false, error: err instanceof ApiError && err.status === 400 ? "invalid" : "failed" };
  }
  revalidatePath("/settings");
  await logSetting((n) => `${n} mengubah instruksi bot`, "default_prompt_sections");
  return { ok: true };
}
