"use server";

import { revalidatePath } from "next/cache";
import { apiFetch } from "@/lib/api/client";
import { createLog } from "@/lib/api/activityLogs";
import { isReadOnly, sessionStaff } from "@/lib/session";
import type { Message } from "@/types/api";

/**
 * A staff reply from the Percakapan screen. The sender is always the session's staff member: the
 * name labels the bubble and becomes the chat's assignedAgent and takeover note on the API, and a
 * server action is a public POST, so it is never taken from the browser.
 */
export async function sendMessage(conversationId: string, body: string) {
  // Marketing is read-only and never reaches a conversation; the screen shows a failed send.
  if (await isReadOnly()) throw new Error("FORBIDDEN");
  const { staffName } = await sessionStaff();

  const envelope = await apiFetch<Message>("/send", {
    method: "POST",
    body: JSON.stringify({ conversationId, body, senderName: staffName }),
  });
  revalidatePath(`/conversations/${conversationId}`);

  createLog({
    message: `${staffName} mengirim pesan ke percakapan`,
    performedBy: staffName,
    entityType: "conversation",
    entityId: conversationId,
  }).catch(() => {});

  return envelope.data;
}
