import type { Lead } from "@/types/api";

/** Customer-written text (the AI's proof quote, the first message) never reaches the read-only role. */
export function stripCustomerText<T extends Pick<Lead, "outcomeEvidence" | "firstMessage">>(rows: T[]): T[] {
  return rows.map((r) => ({ ...r, outcomeEvidence: null, firstMessage: null }));
}
