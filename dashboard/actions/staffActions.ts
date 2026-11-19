"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { createStaff, patchStaff, deleteStaff } from "@/lib/api/staff";
import { createLog } from "@/lib/api/activityLogs";

async function requireAdmin(): Promise<boolean> {
  const session = await auth();
  return (session?.user as { role?: string })?.role === "admin";
}

export async function createStaffAction(data: {
  email: string;
  password: string;
  displayName: string;
  role: "admin" | "agent" | "marketing";
}) {
  if (!(await requireAdmin())) throw new Error("FORBIDDEN");
  const session = await auth();
  const adminName = session?.user?.name ?? "Admin";

  const staff = await createStaff(data);
  revalidatePath("/admin");

  createLog({
    message: `${adminName} membuat staff baru: ${data.displayName} (${data.role})`,
    performedBy: adminName,
    entityType: "staff",
    entityId: staff.id,
  }).catch(() => {});

  return staff;
}

export async function patchStaffAction(
  id: string,
  data: {
    email?: string;
    displayName?: string;
    role?: "admin" | "agent" | "marketing";
    isActive?: boolean;
    newPassword?: string;
  }
) {
  if (!(await requireAdmin())) throw new Error("FORBIDDEN");
  const session = await auth();
  const adminName = session?.user?.name ?? "Admin";

  const staff = await patchStaff(id, data);
  revalidatePath("/admin");

  const isPasswordOnly = Object.keys(data).length === 1 && data.newPassword !== undefined;
  const logMessage = isPasswordOnly
    ? `${adminName} mereset password staff: ${staff.displayName}`
    : `${adminName} mengubah data staff: ${staff.displayName}`;

  createLog({
    message: logMessage,
    performedBy: adminName,
    entityType: "staff",
    entityId: id,
  }).catch(() => {});

  return staff;
}

export async function deleteStaffAction(id: string) {
  if (!(await requireAdmin())) throw new Error("FORBIDDEN");
  const session = await auth();
  const adminName = session?.user?.name ?? "Admin";

  await deleteStaff(id);
  revalidatePath("/admin");

  createLog({
    message: `${adminName} menghapus staff: ${id}`,
    performedBy: adminName,
    entityType: "staff",
    entityId: id,
  }).catch(() => {});
}

export async function changeOwnPasswordAction(newPassword: string): Promise<{ error?: string }> {
  const session = await auth();
  const userId = session?.user?.id;
  const userName = session?.user?.name ?? "Pengguna";

  if (!userId) {
    return { error: "Sesi tidak valid. Silakan login ulang." };
  }

  try {
    await patchStaff(userId, { newPassword });

    createLog({
      message: `${userName} mengubah password sendiri`,
      performedBy: userName,
      entityType: "staff",
      entityId: userId,
    }).catch(() => {});

    return {};
  } catch {
    return { error: "Gagal menyimpan password. Coba lagi." };
  }
}
