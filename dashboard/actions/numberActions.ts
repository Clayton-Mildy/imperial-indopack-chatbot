"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  createNumber,
  patchNumber,
  deleteNumber,
} from "@/lib/api/numbers";
import { createLog } from "@/lib/api/activityLogs";

async function requireAdmin(): Promise<boolean> {
  const session = await auth();
  return (session?.user as { role?: string })?.role === "admin";
}

export async function createPhoneNumber(data: {
  number: string;
  label?: string;
  wabaId: string;
  phoneNumberId: string;
  customSystemPrompt?: string | null;
}) {
  if (!(await requireAdmin())) throw new Error("FORBIDDEN");
  const session = await auth();
  const adminName = session?.user?.name ?? "Admin";

  const num = await createNumber(data);
  revalidatePath("/numbers");

  createLog({
    message: `${adminName} menambahkan nomor WhatsApp: ${data.label ?? data.number}`,
    performedBy: adminName,
    entityType: "phoneNumber",
    entityId: num.id,
  }).catch(() => {});

  return num;
}

export async function updatePhoneNumber(
  id: string,
  data: { label?: string; customSystemPrompt?: string | null }
) {
  if (!(await requireAdmin())) throw new Error("FORBIDDEN");
  const session = await auth();
  const adminName = session?.user?.name ?? "Admin";

  const num = await patchNumber(id, data);
  revalidatePath("/numbers");

  createLog({
    message: `${adminName} mengubah data nomor WhatsApp`,
    performedBy: adminName,
    entityType: "phoneNumber",
    entityId: id,
  }).catch(() => {});

  return num;
}

export async function removeNumber(id: string) {
  if (!(await requireAdmin())) throw new Error("FORBIDDEN");
  const session = await auth();
  const adminName = session?.user?.name ?? "Admin";

  await deleteNumber(id);
  revalidatePath("/numbers");

  createLog({
    message: `${adminName} menghapus nomor WhatsApp: ${id}`,
    performedBy: adminName,
    entityType: "phoneNumber",
    entityId: id,
  }).catch(() => {});
}
