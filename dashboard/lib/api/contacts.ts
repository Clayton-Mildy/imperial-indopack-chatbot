import { apiFetch } from "./client";
import type { Contact, ContactWithProfile, PaginatedResponse } from "@/types/api";

export async function getContacts(params?: {
  page?: number;
  limit?: number;
  search?: string;
  followUpStatus?: string;
}): Promise<PaginatedResponse<ContactWithProfile>> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.search) qs.set("search", params.search);
  if (params?.followUpStatus) qs.set("followUpStatus", params.followUpStatus);

  const query = qs.toString() ? `?${qs.toString()}` : "";
  const envelope = await apiFetch<ContactWithProfile[]>(`/contacts${query}`);

  return {
    data: envelope.data ?? [],
    meta: envelope.meta ?? { page: 1, total: 0, limit: 20 },
  };
}

/** null clears the override so the contact follows the global default again. */
export async function patchContactAiEnabled(id: string, aiEnabled: boolean | null): Promise<Contact> {
  const envelope = await apiFetch<Contact>(`/contacts/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ aiEnabled }),
  });
  if (!envelope.data) throw new Error("Failed to update contact");
  return envelope.data;
}
