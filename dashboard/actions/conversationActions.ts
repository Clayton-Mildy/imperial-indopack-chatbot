"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { patchConversation } from "@/lib/api/conversations";
import { createLog } from "@/lib/api/activityLogs";

export async function resolveConversation(id: string) {
  const session = await auth();
  const agentName = session?.user?.name ?? "Agen";

  await patchConversation(id, { status: "resolved" });
  revalidatePath(`/conversations/${id}`);
  revalidatePath("/conversations");
  revalidatePath("/team-queue");

  createLog({
    message: `${agentName} menyelesaikan percakapan`,
    performedBy: agentName,
    entityType: "conversation",
    entityId: id,
  }).catch(() => {});
}

export async function takeOverConversation(id: string) {
  const session = await auth();
  const agentName = session?.user?.name ?? "Agen";

  await patchConversation(id, { status: "needs_human" });
  revalidatePath(`/conversations/${id}`);
  revalidatePath("/conversations");
  revalidatePath("/team-queue");

  createLog({
    message: `${agentName} mengambil alih percakapan`,
    performedBy: agentName,
    entityType: "conversation",
    entityId: id,
  }).catch(() => {});
}

export async function returnToAi(id: string) {
  const session = await auth();
  const agentName = session?.user?.name ?? "Agen";

  await patchConversation(id, { status: "active" });
  revalidatePath(`/conversations/${id}`);
  revalidatePath("/conversations");
  revalidatePath("/team-queue");

  createLog({
    message: `${agentName} mengembalikan percakapan ke AI`,
    performedBy: agentName,
    entityType: "conversation",
    entityId: id,
  }).catch(() => {});
}
