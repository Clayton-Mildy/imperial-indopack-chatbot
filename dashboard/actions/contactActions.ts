"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { patchContactAiEnabled } from "@/lib/api/contacts";
import { createLog } from "@/lib/api/activityLogs";
import { isReadOnly } from "@/lib/session";

export async function setContactAi(
  id: string,
  aiEnabled: boolean | null
): Promise<{ ok: boolean; error?: string }> {
  if (await isReadOnly()) return { ok: false, error: "Akses hanya baca." };

  const session = await auth();
  const agentName = session?.user?.name ?? "Agen";

  try {
    await patchContactAiEnabled(id, aiEnabled);
  } catch {
    return { ok: false, error: "Gagal menyimpan. Silakan coba lagi." };
  }

  revalidatePath("/leads");
  revalidatePath("/conversations", "layout");

  createLog({
    message: `${agentName} ${aiEnabled === null ? "mengembalikan AI ke pengaturan global untuk" : aiEnabled ? "mengaktifkan AI untuk" : "menonaktifkan AI untuk"} satu pelanggan`,
    performedBy: agentName,
    entityType: "contact",
    entityId: id,
  }).catch(() => {});

  return { ok: true };
}
