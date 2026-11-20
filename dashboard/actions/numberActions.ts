"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  createNumber,
  patchNumber,
  deleteNumber,
} from "@/lib/api/numbers";
import { createLog } from "@/lib/api/activityLogs";
import { ApiError } from "@/lib/api/client";
import { getT } from "@/lib/i18n";

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

/**
 * Deletes a number. One that still has chats is refused by the API (409): its message says how many,
 * instead of the error the page used to swallow (live 2026-11-20).
 */
export async function removeNumber(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const t = await getT();
  if (!(await requireAdmin())) return { ok: false, error: t("common.err.generic") };
  const session = await auth();
  const adminName = session?.user?.name ?? "Admin";

  try {
    await deleteNumber(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409 && err.code === "NUMBER_HAS_CONVERSATIONS") {
      const n = Number((err.details as { conversations?: unknown } | undefined)?.conversations) || 0;
      return { ok: false, error: t("numbers.err.hasChats", { n: String(n) }) };
    }
    if (err instanceof ApiError && err.status === 404) return { ok: false, error: t("common.err.notFound") };
    return { ok: false, error: t("numbers.err.deleteFailed") };
  }
  revalidatePath("/numbers");

  createLog({
    message: `${adminName} menghapus nomor WhatsApp: ${id}`,
    performedBy: adminName,
    entityType: "phoneNumber",
    entityId: id,
  }).catch(() => {});
  return { ok: true };
}
