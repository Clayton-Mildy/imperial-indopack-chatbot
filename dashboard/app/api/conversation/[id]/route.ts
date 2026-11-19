import { NextRequest, NextResponse } from "next/server";
import { apiFetch } from "@/lib/api/client";
import type { ConversationWithMessages } from "@/types/api";

/**
 * Proxy route: GET /api/conversation/:id
 * Fetches conversation + messages from the backend and returns to the client.
 * This exists so the client-side TestPromptClient can load saved conversations
 * without exposing API_SECRET_KEY to the browser.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const envelope = await apiFetch<ConversationWithMessages>(
      `/conversations/${id}`
    );

    if (!envelope.data) {
      return NextResponse.json(
        { data: null, error: "Percakapan tidak ditemukan" },
        { status: 404 }
      );
    }

    // The backend returns { conversation, messages } nested under data,
    // or a flat ConversationWithMessages — normalise to { conversation, messages }
    const raw = envelope.data as ConversationWithMessages & {
      conversation?: ConversationWithMessages;
      messages?: ConversationWithMessages["messages"];
    };

    const conversation = raw.conversation ?? raw;
    const messages = raw.messages ?? [];

    return NextResponse.json({ data: { conversation, messages } });
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 500;
    const message =
      err instanceof Error ? err.message : "Gagal memuat percakapan";
    return NextResponse.json({ data: null, error: message }, { status });
  }
}
