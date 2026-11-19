import { apiFetch } from "./client";
import type { Conversation } from "@/types/api";

export async function getEscalations(): Promise<Conversation[]> {
  const envelope = await apiFetch<Conversation[]>("/escalations");
  return envelope.data ?? [];
}
