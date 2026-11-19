// Size guard for the multipart proxies (catalog import, brand price lists). With a Content-Length
// the verdict comes from the header, before any of the body is read; without one (Cloudflare can
// forward an upload chunked, and the API's /app proxy copies Content-Length only when it had one)
// the body is counted while it is read and dropped as soon as it passes the cap. The API checks
// the file itself again.

/** Room for the multipart boundary, part headers and the file name around the file itself. */
export const MULTIPART_SLACK_BYTES = 64 * 1024;
export const XLSX_MAX_BYTES = 5 * 1024 * 1024;
export const PDF_MAX_BYTES = 20 * 1024 * 1024;

export type UploadRefusal = {
  status: 400 | 413;
  error: "INVALID_CONTENT_LENGTH" | "FILE_TOO_LARGE" | "INVALID_FORM_DATA";
};
export type UploadResult = { ok: true; formData: FormData } | ({ ok: false } & UploadRefusal);

/**
 * The header's verdict for a file of at most `maxFileBytes`: 400 for a value that is not a whole
 * number of bytes, 413 above the cap plus the multipart slack, null when the body may be read. An
 * absent or blank header is null too: no verdict, readCappedFormData counts the body instead.
 */
export function uploadRefusal(contentLength: string | null, maxFileBytes: number): UploadRefusal | null {
  const header = contentLength?.trim() ?? "";
  if (header === "") return null;
  if (!/^\d+$/.test(header)) return { status: 400, error: "INVALID_CONTENT_LENGTH" };
  const bytes = Number(header);
  if (!Number.isSafeInteger(bytes) || bytes > maxFileBytes + MULTIPART_SLACK_BYTES) return { status: 413, error: "FILE_TOO_LARGE" };
  return null;
}

async function parse(read: () => Promise<FormData>): Promise<UploadResult> {
  try {
    return { ok: true, formData: await read() };
  } catch {
    return { ok: false, status: 400, error: "INVALID_FORM_DATA" };
  }
}

/** The request's multipart form, read only while it stays within `maxFileBytes` plus the slack. */
export async function readCappedFormData(request: Request, maxFileBytes: number): Promise<UploadResult> {
  const header = request.headers.get("content-length");
  if (header !== null && header.trim() !== "") {
    const refusal = uploadRefusal(header, maxFileBytes);
    if (refusal) return { ok: false, ...refusal };
    // The HTTP layer holds the body to its declared length, so the header is the cap here.
    return parse(() => request.formData());
  }

  const limit = maxFileBytes + MULTIPART_SLACK_BYTES;
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => {});
        return { ok: false, status: 413, error: "FILE_TOO_LARGE" };
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const contentType = request.headers.get("content-type") ?? "";
  return parse(() => new Response(bytes, { headers: { "content-type": contentType } }).formData());
}
