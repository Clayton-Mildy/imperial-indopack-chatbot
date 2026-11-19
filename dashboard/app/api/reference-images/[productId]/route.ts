import { NextRequest, NextResponse } from 'next/server';
import { isJpgOrPng } from '@/lib/catalog/productForm';
import { sessionRole } from '@/lib/session';
import { IMAGE_MAX_BYTES, readCappedFormData } from '@/lib/uploadLimit';

// Route handler = server-side; prefer the container-to-container URL over the browser's view.
// A proxy rather than a direct browser->API call because API_SECRET_KEY must never reach the
// browser, and multipart can't go through the JSON-only apiFetch helper.
const API_URL =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:50070';
const API_KEY = process.env.API_SECRET_KEY ?? '';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ productId: string }> };

const refuse = (status: number, error: string) => NextResponse.json({ data: null, error }, { status });

/**
 * POST /api/reference-images/:productId - multipart, one JPG/PNG of at most 5 MB: a design-reference
 * photo the bot sends (Plan 1's POST /products/:id/reference-images; 409 once the product has 3).
 * Admin-only like every catalog write.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const { productId } = await params;
  if ((await sessionRole()) !== 'admin') return refuse(403, 'FORBIDDEN');
  if (!UUID_RE.test(productId)) return refuse(404, 'NOT_FOUND');
  // Over the cap it is refused by Content-Length unread, or (chunked, no header) as soon as the
  // bytes read pass it; never buffered whole.
  const upload = await readCappedFormData(request, IMAGE_MAX_BYTES);
  if (!upload.ok) return refuse(upload.status, upload.error);

  const file = upload.formData.get('file');
  if (!(file instanceof File)) return refuse(400, 'NO_FILE');
  // The API takes any image up to 20 MB; the form promises JPG/PNG up to 5 MB, so that is held here too.
  if (!isJpgOrPng(file)) return refuse(400, 'UNSUPPORTED_MIME_TYPE');
  if (file.size > IMAGE_MAX_BYTES) return refuse(413, 'FILE_TOO_LARGE');

  // A file the browser sent without a type passed on its extension; the API needs an image/* type.
  const typed = file.type ? file : new File([file], file.name, { type: /\.png$/i.test(file.name) ? 'image/png' : 'image/jpeg' });
  const form = new FormData();
  form.append('file', typed, file.name);
  const res = await fetch(`${API_URL}/api/v1/products/${productId}/reference-images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: form,
  });
  const body = await res.json().catch(() => ({ data: null, error: `HTTP_${res.status}` }));
  return NextResponse.json(body, { status: res.status });
}
