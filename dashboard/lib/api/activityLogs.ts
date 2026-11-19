import { apiFetch } from "./client";
import type { ActivityLog } from "@/types/api";

export async function createLog(data: {
  message: string;
  performedBy: string;
  entityType?: string;
  entityId?: string;
}): Promise<void> {
  await apiFetch("/activity-logs", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function listActivityLogs(params: {
  page?: number;
  limit?: number;
  search?: string;
  startDate?: string;
  endDate?: string;
}): Promise<{ data: ActivityLog[]; meta: { page: number; total: number; limit: number } }> {
  const qs = new URLSearchParams();
  if (params.page) qs.set("page", String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.search) qs.set("search", params.search);
  if (params.startDate) qs.set("startDate", params.startDate);
  if (params.endDate) qs.set("endDate", params.endDate);

  const query = qs.toString();
  const envelope = await apiFetch<ActivityLog[]>(`/activity-logs${query ? `?${query}` : ""}`);
  return {
    data: envelope.data ?? [],
    meta: envelope.meta ?? { page: 1, total: 0, limit: 20 },
  };
}
