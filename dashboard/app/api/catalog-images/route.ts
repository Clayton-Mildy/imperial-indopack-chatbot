import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

// Route handler = server-side; prefer the container-to-container URL over the browser's view.
// A proxy rather than a direct browser->API call because API_SECRET_KEY must never reach the
// browser, and multipart can't go through the JSON-only apiFetch helper.
const API_URL =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:50070';
const API_KEY = process.env.API_SECRET_KEY ?? '';

export async function POST(request: NextRequest) {
  // The real trust boundary. proxy.ts's AGENT_BLOCKED list does not contain /catalog, so every
  // logged-in agent can reach this route; single-row catalog edits are admin-only via
  // catalogActions' requireAdmin, and a bulk upload of catalog photos must be at least that.
  const session = await auth();
  if ((session?.user as { role?: string })?.role !== 'admin') {
    return NextResponse.json({ data: null, error: 'FORBIDDEN' }, { status: 403 });
  }

  const formData = await request.formData();
  const res = await fetch(`${API_URL}/api/v1/catalog/images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: formData,
  });
  const body = await res.json();
  return NextResponse.json(body, { status: res.status });
}
