import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/ids';
import { sessionRole } from '@/lib/session';

// Route handler = server-side; prefer the container-to-container URL over the browser's view.
// A proxy because API_SECRET_KEY must never reach the browser.
const API_URL =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:50070';
const API_KEY = process.env.API_SECRET_KEY ?? '';

type Ctx = { params: Promise<{ photoId: string }> };

const refuse = (status: number, error: string) => NextResponse.json({ data: null, error }, { status });

/** DELETE /api/product-photos/:photoId - removes one product photo. Admin-only like every catalog write. */
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const { photoId } = await params;
  if ((await sessionRole()) !== 'admin') return refuse(403, 'FORBIDDEN');
  if (!isUuid(photoId)) return refuse(404, 'NOT_FOUND');
  const res = await fetch(`${API_URL}/api/v1/product-photos/${encodeURIComponent(photoId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  if (res.status === 204) return new NextResponse(null, { status: 204 });
  const body = await res.json().catch(() => ({ data: null, error: `HTTP_${res.status}` }));
  return NextResponse.json(body, { status: res.status });
}
