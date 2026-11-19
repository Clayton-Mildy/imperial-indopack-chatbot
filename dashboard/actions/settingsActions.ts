"use server";

import { revalidatePath } from "next/cache";
import { apiFetch } from "@/lib/api/client";
import { auth } from "@/lib/auth";
import { createLog } from "@/lib/api/activityLogs";
import type { PromptSection, ChakraSyncStatus } from "@/types/api";
import { sessionRole } from "@/lib/session";
import { setLeadReopenDays, setLeadSilenceDays } from "@/lib/api/settings";

export type LeadReopenResult = { ok: true; days: number } | { ok: false; error: "forbidden" | "invalid" | "failed" };

/** Admin only, re-checked here: a "use server" action is callable by any session. */
export async function saveLeadReopenDays(days: number): Promise<LeadReopenResult> {
  if ((await sessionRole()) !== "admin") return { ok: false, error: "forbidden" };
  if (!Number.isInteger(days) || days < 1 || days > 365) return { ok: false, error: "invalid" };
  try {
    const saved = await setLeadReopenDays(days);
    revalidatePath("/settings");
    return { ok: true, days: saved };
  } catch {
    return { ok: false, error: "failed" };
  }
}

/** Admin only, like the reopen days. */
export async function saveLeadSilenceDays(days: number): Promise<LeadReopenResult> {
  if ((await sessionRole()) !== "admin") return { ok: false, error: "forbidden" };
  if (!Number.isInteger(days) || days < 1 || days > 365) return { ok: false, error: "invalid" };
  try {
    const saved = await setLeadSilenceDays(days);
    revalidatePath("/settings");
    return { ok: true, days: saved };
  } catch {
    return { ok: false, error: "failed" };
  }
}

async function requireAdmin(): Promise<boolean> {
  const session = await auth();
  return (session?.user as { role?: string })?.role === "admin";
}

export async function getPromptDefaults(): Promise<PromptSection[]> {
  try {
    const envelope = await apiFetch<PromptSection[]>("/settings/prompt-defaults");
    return envelope.data ?? [];
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 501 || status === 404) return [];
    console.warn("[settings] Failed to fetch prompt defaults:", err);
    return [];
  }
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

export async function setAiDefault(aiEnabled: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!(await requireAdmin())) return { ok: false, error: "Anda tidak memiliki izin untuk melakukan perubahan ini." };
  const session = await auth();
  const adminName = session?.user?.name ?? "Admin";

  try {
    await apiFetch("/settings/ai-default", {
      method: "PATCH",
      body: JSON.stringify({ aiEnabled }),
    });
  } catch {
    return { ok: false, error: "Gagal menyimpan. Silakan coba lagi." };
  }

  revalidatePath("/settings");
  createLog({
    message: `${adminName} ${aiEnabled ? "mengaktifkan" : "menonaktifkan"} balasan otomatis AI untuk semua percakapan`,
    performedBy: adminName,
    entityType: "settings",
    entityId: "ai_enabled_default",
  }).catch(() => {});

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
  if (!(await requireAdmin())) return { ok: false, error: "Anda tidak memiliki izin untuk melakukan perubahan ini." };
  const session = await auth();
  const adminName = session?.user?.name ?? "Admin";

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
  if (started) {
    createLog({
      message: `${adminName} menjalankan sinkronisasi riwayat percakapan ChakraHQ`,
      performedBy: adminName,
      entityType: "settings",
      entityId: "chakra_sync_state",
    }).catch(() => {});
  }

  return { ok: true };
}

export async function savePromptDefaults(sections: PromptSection[]): Promise<{ ok: boolean; error?: string }> {
  if (!(await requireAdmin())) return { ok: false, error: "Anda tidak memiliki izin untuk melakukan perubahan ini." };
  try {
    await apiFetch("/settings/prompt-defaults", {
      method: "PATCH",
      body: JSON.stringify({ sections }),
    });
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    let friendly = "Gagal menyimpan prompt. Silakan coba lagi.";
    if (msg.includes("VALIDATION") || msg.includes("validation"))
      friendly = "Data yang dimasukkan tidak valid. Mohon periksa kembali.";
    else if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("fetch"))
      friendly = "Tidak dapat terhubung ke server. Periksa koneksi internet Anda.";
    return { ok: false, error: friendly };
  }
}
