import { apiFetch } from "./client";
import type { TeamQueue } from "@/types/api";

/** The Perlu Tim queue (api/src/routes/dashboard/teamQueue.ts); `assignedTo` = "Ditangani saya". */
export async function getTeamQueue(assignedTo?: string): Promise<TeamQueue> {
  const qs = assignedTo ? `?assignedTo=${encodeURIComponent(assignedTo)}` : "";
  const envelope = await apiFetch<TeamQueue>(`/team-queue${qs}`);
  if (!envelope.data) throw new Error("Failed to load team queue");
  return envelope.data;
}
