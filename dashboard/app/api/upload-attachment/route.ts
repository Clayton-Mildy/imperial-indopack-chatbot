import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Route handler = server-side; prefer the container-to-container URL over the browser's view.
const API_URL =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:50070";
const API_KEY = process.env.API_SECRET_KEY ?? "";

export async function POST(request: NextRequest) {
  const conversationId = request.nextUrl.searchParams.get("conversationId");
  if (!conversationId) {
    return NextResponse.json({ error: "Missing conversationId" }, { status: 400 });
  }

  // The bubble is labelled with this name, like a typed reply - without it a staff upload read "AI".
  const session = await auth();
  const qs = new URLSearchParams({ senderName: session?.user?.name ?? "Tim CS" });

  // Forward the multipart body directly to the backend
  const formData = await request.formData();
  const res = await fetch(
    `${API_URL}/api/v1/conversations/${conversationId}/attachments?${qs}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}` },
      body: formData,
    }
  );

  const body = await res.json();
  return NextResponse.json(body, { status: res.status });
}
