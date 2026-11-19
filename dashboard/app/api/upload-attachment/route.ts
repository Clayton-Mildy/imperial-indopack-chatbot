import { NextRequest, NextResponse } from "next/server";
import { isUuid } from "@/lib/ids";
import { sessionStaff } from "@/lib/session";

// Route handler = server-side; prefer the container-to-container URL over the browser's view.
const API_URL =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:50070";
const API_KEY = process.env.API_SECRET_KEY ?? "";

export async function POST(request: NextRequest) {
  // Checked before anything is forwarded: it goes into the API path, and "..%2Fcatalog%2Fimport%3F"
  // would otherwise turn this upload into an admin-only catalog import.
  const conversationId = request.nextUrl.searchParams.get("conversationId");
  if (!isUuid(conversationId)) {
    return NextResponse.json({ data: null, error: "INVALID_CONVERSATION_ID" }, { status: 400 });
  }

  // The bubble is labelled with this name, like a typed reply - without it a staff upload read "AI".
  // The same session name the reply box shows (sessionStaff), never one sent by the browser.
  const { staffName } = await sessionStaff();
  const qs = new URLSearchParams({ senderName: staffName });

  // Forward the multipart body directly to the backend
  const formData = await request.formData();
  const res = await fetch(
    `${API_URL}/api/v1/conversations/${encodeURIComponent(conversationId)}/attachments?${qs}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}` },
      body: formData,
    }
  );

  const body = await res.json();
  return NextResponse.json(body, { status: res.status });
}
