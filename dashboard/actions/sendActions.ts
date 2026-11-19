"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { apiFetch } from "@/lib/api/client";
import { createLog } from "@/lib/api/activityLogs";
import type { Message } from "@/types/api";

export async function sendMessage(conversationId: string, body: string, senderName: string) {
  const session = await auth();
  const agentName = session?.user?.name ?? senderName;

  const envelope = await apiFetch<Message>("/send", {
    method: "POST",
    body: JSON.stringify({ conversationId, body, senderName }),
  });
  revalidatePath(`/conversations/${conversationId}`);

  createLog({
    message: `${agentName} mengirim pesan ke percakapan`,
    performedBy: agentName,
    entityType: "conversation",
    entityId: conversationId,
  }).catch(() => {});

  return envelope.data;
}
