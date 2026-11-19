import { apiFetch } from "./client";
import type { Conversation, ConversationWithMessages, ContactProfile, PaginatedResponse } from "@/types/api";

export async function getConversations(params?: {
  status?: string;
  page?: number;
  limit?: number;
  search?: string;
  upsell_accepted?: boolean;
}): Promise<PaginatedResponse<Conversation>> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.page) qs.set("page", String(params.page));
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.search) qs.set("search", params.search);
  if (params?.upsell_accepted) qs.set("upsell_accepted", "true");

  const query = qs.toString() ? `?${qs.toString()}` : "";
  const envelope = await apiFetch<Conversation[]>(`/conversations${query}`);

  return {
    data: envelope.data ?? [],
    meta: envelope.meta ?? { page: 1, total: 0, limit: 20 },
  };
}

export async function getConversation(id: string): Promise<ConversationWithMessages> {
  const envelope = await apiFetch<ConversationWithMessages>(`/conversations/${id}`);
  if (!envelope.data) {
    throw new Error("Conversation not found");
  }
  return envelope.data;
}

export async function patchConversation(
  id: string,
  data: { status?: string; assignedAgent?: string }
): Promise<Conversation> {
  const envelope = await apiFetch<Conversation>(`/conversations/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  if (!envelope.data) {
    throw new Error("Failed to update conversation");
  }
  return envelope.data;
}

export async function getContactProfile(conversationId: string): Promise<ContactProfile | null> {
  const envelope = await apiFetch<ContactProfile | null>(`/conversations/${conversationId}/contact-profile`);
  return envelope.data ?? null;
}

export async function markFollowUpDone(conversationId: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/conversations/${conversationId}/contact-profile/follow-up-done`, {
    method: "PATCH",
  });
}
