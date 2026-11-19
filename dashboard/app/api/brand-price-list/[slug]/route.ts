import { NextRequest, NextResponse } from 'next/server';
import { isBrandSlug } from '@/lib/brands';
import { sessionRole } from '@/lib/session';

// Route handler = server-side; prefer the container-to-container URL over the browser's view.
// A proxy rather than a direct browser->API call because API_SECRET_KEY must never reach the
// browser, and multipart can't go through the JSON-only apiFetch helper.
const API_URL =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:50070';
const API_KEY = process.env.API_SECRET_KEY ?? '';

type Ctx = { params: Promise<{ slug: string }> };

/** Admin-only like every other catalog write; the slug must be one of the two brands. */
async function guard(slug: string): Promise<NextResponse | null> {
  if ((await sessionRole()) !== 'admin') {
    return NextResponse.json({ data: null, error: 'FORBIDDEN' }, { status: 403 });
  }
  if (!isBrandSlug(slug)) return NextResponse.json({ data: null, error: 'NOT_FOUND' }, { status: 404 });
  return null;
}

async function forward(res: Response): Promise<NextResponse> {
  const body = await res.json().catch(() => ({ data: null, error: `HTTP_${res.status}` }));
  return NextResponse.json(body, { status: res.status });
}

/** POST /api/brand-price-list/:slug - multipart, one PDF (at most 20 MB): the file the bot sends. */
export async function POST(request: NextRequest, { params }: Ctx) {
  const { slug } = await params;
  const refused = await guard(slug);
  if (refused) return refused;

  const formData = await request.formData();
  const res = await fetch(`${API_URL}/api/v1/brands/${slug}/price-list`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: formData,
  });
  return forward(res);
}

/** DELETE /api/brand-price-list/:slug - the bot then says the list is not available yet. */
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const { slug } = await params;
  const refused = await guard(slug);
  if (refused) return refused;

  const res = await fetch(`${API_URL}/api/v1/brands/${slug}/price-list`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  return forward(res);
}
