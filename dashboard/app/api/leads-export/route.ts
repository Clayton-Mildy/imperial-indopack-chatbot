import { NextRequest, NextResponse } from 'next/server';
import { isReadOnly } from '@/lib/session';

// Route handler = server-side; prefer the container-to-container URL over the browser's view.
// A proxy rather than a direct browser->API call because API_SECRET_KEY must never reach the
// browser. Auth is handled by proxy.ts, whose matcher covers everything except /api/auth and
// /login - an unauthenticated GET here is redirected before it reaches this code.
const API_URL =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:50070';
const API_KEY = process.env.API_SECRET_KEY ?? '';

export async function GET(request: NextRequest) {
  // The filters are forwarded as they are: the file must match the filtered view the button was
  // clicked from. redact is the server's call, never the browser's: marketing (read-only, the one
  // role this route is on the allow-list for) gets the file without the customer's own text, as
  // the leads pages strip it for that role (stripCustomerText).
  const qs = new URLSearchParams(request.nextUrl.searchParams);
  qs.delete('redact');
  if (await isReadOnly()) qs.set('redact', '1');
  const query = qs.toString();
  const res = await fetch(`${API_URL}/api/v1/leads/export${query ? `?${query}` : ''}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
    cache: 'no-store',
  });
  if (!res.ok) {
    return NextResponse.json({ data: null, error: 'EXPORT_FAILED' }, { status: res.status });
  }

  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'application/octet-stream',
      'Content-Disposition': res.headers.get('content-disposition') ?? 'attachment',
    },
  });
}
