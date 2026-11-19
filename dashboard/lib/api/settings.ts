import { apiFetch } from "./client";
import type { PromptSection } from "@/types/api";

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

export async function getLeadReopenDays(): Promise<number> {
  const envelope = await apiFetch<{ days: number }>("/settings/lead-reopen-days");
  const days = envelope.data?.days;
  if (typeof days !== "number" || !Number.isInteger(days)) throw new Error("Malformed lead-reopen-days response");
  return days;
}

export async function setLeadReopenDays(days: number): Promise<number> {
  const envelope = await apiFetch<{ days: number }>("/settings/lead-reopen-days", {
    method: "PATCH",
    body: JSON.stringify({ days }),
  });
  return envelope.data?.days ?? days;
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
