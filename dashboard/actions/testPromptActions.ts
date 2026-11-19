"use server";

import { apiFetch } from "@/lib/api/client";

export interface ChatMessage {
  role: "customer" | "bot";
  content: string;
}

export interface ChatResponse {
  reply: string | null;
  escalate: boolean;
  reason?: string;
  confidence: "high" | "low";
  topics: string[];
  systemPrompt: string;
}

export interface SendChatResult {
  ok: true;
  data: ChatResponse;
}

export interface SendChatError {
  ok: false;
  error: string;
}

export async function sendChatMessage(
  phoneNumberId: string,
  messages: ChatMessage[],
  newMessage: string,
  imageData?: { base64: string; mimeType: string }
): Promise<SendChatResult | SendChatError> {
  try {
    const body: Record<string, unknown> = {
      phoneNumberId,
      messages,
      newMessage,
      ...(imageData ? { imageData } : {}),
    };

    const envelope = await apiFetch<ChatResponse>("/test-prompt/chat", {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (!envelope.data) {
      return { ok: false, error: envelope.error ?? "Respons kosong dari server" };
    }

    return { ok: true, data: envelope.data };
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : "Gagal menghubungi server backend";
    return { ok: false, error: msg };
  }
}
