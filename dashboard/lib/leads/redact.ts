import type { Lead } from "@/types/api";

/**
 * Marketing-form fields that carry the customer's own message. The Bukan Lead "Pesan" column
 * falls back to them when there is no first chat message, so it reads this same list.
 */
export const CUSTOMER_MESSAGE_KEYS: readonly string[] = ["apa_yang_anda_butuhkan"];

/**
 * Customer-written text (the AI's proof quote, the first message, the form's message field, the
 * follow-up notes) never reaches the read-only role. The rest of the form payload stays.
 */
export function stripCustomerText<
  T extends Pick<Lead, "outcomeEvidence" | "firstMessage"> & { payload?: Record<string, unknown>; followUpNotes?: string | null },
>(rows: T[]): T[] {
  return rows.map((r) => ({
    ...r,
    outcomeEvidence: null,
    firstMessage: null,
    ...("followUpNotes" in r ? { followUpNotes: null } : {}),
    ...(r.payload
      ? { payload: Object.fromEntries(Object.entries(r.payload).filter(([k]) => !CUSTOMER_MESSAGE_KEYS.includes(k))) }
      : {}),
  }));
}
