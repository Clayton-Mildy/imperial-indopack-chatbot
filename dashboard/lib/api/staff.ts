import { apiFetch, pathId } from "./client";
import type { StaffPublic } from "@/types/api";

export async function listStaff(): Promise<StaffPublic[]> {
  const envelope = await apiFetch<StaffPublic[]>("/staff");
  return envelope.data ?? [];
}

export async function createStaff(data: {
  email: string;
  password: string;
  displayName: string;
  role: "admin" | "agent" | "marketing";
}): Promise<StaffPublic> {
  const envelope = await apiFetch<StaffPublic>("/staff", {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!envelope.data) throw new Error("Failed to create staff");
  return envelope.data;
}

export async function patchStaff(
  id: string,
  data: {
    email?: string;
    displayName?: string;
    role?: "admin" | "agent" | "marketing";
    isActive?: boolean;
    newPassword?: string;
  }
): Promise<StaffPublic> {
  const envelope = await apiFetch<StaffPublic>(`/staff/${pathId(id)}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  if (!envelope.data) throw new Error("Failed to update staff");
  return envelope.data;
}

export async function deleteStaff(id: string): Promise<void> {
  await apiFetch(`/staff/${pathId(id)}`, { method: "DELETE" });
}
