import { apiFetch, pathId } from "./client";
import type { PhoneNumber, PromptSection } from "@/types/api";

export async function getNumbers(): Promise<PhoneNumber[]> {
  const envelope = await apiFetch<PhoneNumber[]>("/numbers");
  return envelope.data ?? [];
}

export async function createNumber(data: {
  number: string;
  label?: string;
  wabaId: string;
  phoneNumberId: string;
  customSystemPrompt?: string | null;
}): Promise<PhoneNumber> {
  const envelope = await apiFetch<PhoneNumber>("/numbers", {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!envelope.data) throw new Error("Failed to create number");
  return envelope.data;
}

export async function patchNumber(
  id: string,
  data: { label?: string; customSystemPrompt?: string | null; promptSections?: PromptSection[] | null }
): Promise<PhoneNumber> {
  const envelope = await apiFetch<PhoneNumber>(`/numbers/${pathId(id)}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  if (!envelope.data) throw new Error("Failed to update number");
  return envelope.data;
}

export async function deleteNumber(id: string): Promise<void> {
  await apiFetch(`/numbers/${pathId(id)}`, { method: "DELETE" });
}
