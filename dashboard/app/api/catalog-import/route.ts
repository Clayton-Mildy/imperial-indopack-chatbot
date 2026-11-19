import { NextRequest, NextResponse } from 'next/server';
import { sessionRole, sessionStaff } from '@/lib/session';
import { XLSX_MAX_BYTES, readCappedFormData } from '@/lib/uploadLimit';

// Route handler = server-side; prefer the container-to-container URL over the browser's view.
// A proxy rather than a direct browser->API call because API_SECRET_KEY must never reach the
// browser, and multipart can't go through the JSON-only apiFetch helper.
const API_URL =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:50070';
const API_KEY = process.env.API_SECRET_KEY ?? '';

/**
 * POST /api/catalog-import?dryRun=1 -> { data: { preview } } (writes nothing)
 * POST /api/catalog-import?fileName= -> { data: { preview, result } } (applies the file)
 * The staff member recorded against the change comes from the session, never from the browser.
 */
export async function POST(request: NextRequest) {
  // The real trust boundary. proxy.ts's AGENT_BLOCKED list does not contain /catalog, so every
  // logged-in agent can reach this route; single-row catalog edits are admin-only via
  // catalogActions, and a bulk rewrite of the whole catalog must be at least that.
  if ((await sessionRole()) !== 'admin') {
    return NextResponse.json({ data: null, error: 'FORBIDDEN' }, { status: 403 });
  }

  // Over the cap it is refused by Content-Length unread, or (chunked, no header) as soon as the
  // bytes read pass it; never buffered whole.
  const upload = await readCappedFormData(request, XLSX_MAX_BYTES);
  if (!upload.ok) return NextResponse.json({ data: null, error: upload.error }, { status: upload.status });
  const formData = upload.formData;
  const file = formData.get('file');
  const dryRun = ['1', 'true'].includes(request.nextUrl.searchParams.get('dryRun') ?? '');
  const qs = new URLSearchParams();
  if (dryRun) {
    qs.set('dryRun', '1');
  } else {
    const fileName = (request.nextUrl.searchParams.get('fileName') ?? (file instanceof File ? file.name : '')).trim();
    if (fileName) qs.set('fileName', fileName.slice(0, 200));
    const { staffId, staffName } = await sessionStaff();
    qs.set('staffName', staffName);
    if (staffId) qs.set('staffId', staffId);
  }

  const res = await fetch(`${API_URL}/api/v1/catalog/import?${qs.toString()}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: formData,
  });
  const body = await res.json().catch(() => ({ data: null, error: `HTTP_${res.status}` }));
  return NextResponse.json(body, { status: res.status });
}
