import { NextResponse } from 'next/server';

// Route handler = server-side; prefer the container-to-container URL over the browser's view.
// Auth is handled by proxy.ts, whose matcher covers everything except /api/auth and /login -
// an unauthenticated GET here is redirected before it reaches this code.
const API_URL =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:50070';
const API_KEY = process.env.API_SECRET_KEY ?? '';

export async function GET() {
  const res = await fetch(`${API_URL}/api/v1/catalog/export`, {
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
