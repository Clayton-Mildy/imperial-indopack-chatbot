import type { ConversationView } from "@/types/api";

// The inbox list's place in the URL (?view&search&page), read by both Percakapan pages so an open
// conversation keeps the list it was opened from. Server-safe: no client code.

export const INBOX_PAGE_SIZE = 30;

export type InboxSearchParams = { view?: string | string[]; search?: string | string[]; page?: string | string[] };

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] ?? "" : v ?? "");

/** Unknown views read as Semua, a bad page as 1, the search trimmed and capped as the API caps it. */
export function inboxQueryOf(p: InboxSearchParams): { view: ConversationView | null; search: string; page: number } {
  const view = one(p.view);
  const page = Number.parseInt(one(p.page), 10);
  return {
    view: view === "team" || view === "ai" || view === "resolved" ? view : null,
    search: one(p.search).trim().slice(0, 200),
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}
