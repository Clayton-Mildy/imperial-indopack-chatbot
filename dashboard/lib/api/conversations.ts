import { apiFetch } from "./client";
import type {
  Conversation,
  ConversationCounts,
  ConversationListMeta,
  ConversationListRow,
  ConversationView,
  ConversationWithMessages,
  OrderPanel,
  QuickSendAction,
  QuickSendItem,
  TeamNotes,
} from "@/types/api";

// The Percakapan screen's API (api/src/routes/dashboard/conversations.ts).

const EMPTY_COUNTS: ConversationCounts = { all: 0, team: 0, ai: 0, resolved: 0 };

/** One inbox page: the tab (none = all), the search over name, business and number. */
export async function getConversations(params: {
  view?: ConversationView;
  search?: string;
  page?: number;
  limit?: number;
}): Promise<{ rows: ConversationListRow[]; meta: ConversationListMeta }> {
  const qs = new URLSearchParams();
  if (params.view) qs.set("view", params.view);
  if (params.search) qs.set("search", params.search);
  if (params.page) qs.set("page", String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));
  const query = qs.toString();
  const envelope = await apiFetch<ConversationListRow[]>(`/conversations${query ? `?${query}` : ""}`);
  // This route's meta carries counts beside the paging fields ApiEnvelope declares.
  const meta = envelope.meta as unknown as Partial<ConversationListMeta> | undefined;
  return {
    rows: envelope.data ?? [],
    meta: {
      page: meta?.page ?? params.page ?? 1,
      total: meta?.total ?? 0,
      limit: meta?.limit ?? params.limit ?? 20,
      counts: { ...EMPTY_COUNTS, ...meta?.counts },
    },
  };
}

export async function getConversation(id: string): Promise<ConversationWithMessages> {
  const envelope = await apiFetch<ConversationWithMessages>(`/conversations/${encodeURIComponent(id)}`);
  if (!envelope.data) {
    throw new Error("Conversation not found");
  }
  return envelope.data;
}

export async function patchConversation(
  id: string,
  data: { status?: string; assignedAgent?: string }
): Promise<Conversation> {
  const envelope = await apiFetch<Conversation>(`/conversations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  if (!envelope.data) {
    throw new Error("Failed to update conversation");
  }
  return envelope.data;
}

/** The order panel: six details, nearest catalog items, customer files, team notes. A 404 throws ApiError(404). */
export async function getOrderPanel(conversationId: string): Promise<OrderPanel> {
  const envelope = await apiFetch<OrderPanel>(`/conversations/${encodeURIComponent(conversationId)}/order-panel`);
  if (!envelope.data) throw new Error("ORDER_PANEL_EMPTY");
  return envelope.data;
}

/** Catatan tim (at most 2000 characters), written by the session's staff member. */
export async function saveTeamNotes(conversationId: string, text: string, staffName: string): Promise<TeamNotes> {
  const envelope = await apiFetch<TeamNotes>(`/conversations/${encodeURIComponent(conversationId)}/team-notes`, {
    method: "PATCH",
    body: JSON.stringify({ text, staffName }),
  });
  if (!envelope.data) throw new Error("TEAM_NOTES_EMPTY");
  return envelope.data;
}

/**
 * A price list, reference photos or the PO form link, sent as the staff member. One stored row per
 * item ('saved' = the provider refused it). A 404 or 409 throws ApiError with the QuickSendError as its message.
 */
export async function quickSend(conversationId: string, action: QuickSendAction, staffName: string): Promise<QuickSendItem[]> {
  const envelope = await apiFetch<{ sent: QuickSendItem[] }>(`/conversations/${encodeURIComponent(conversationId)}/quick-send`, {
    method: "POST",
    body: JSON.stringify({ action, staffName }),
  });
  return envelope.data?.sent ?? [];
}
