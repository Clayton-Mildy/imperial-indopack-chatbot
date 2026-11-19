// Size guard for the multipart proxies (catalog import, brand price lists): judged on the
// Content-Length header before the body is buffered, so an oversized upload is refused without
// reading it. The API checks the file itself again.

/** Room for the multipart boundary, part headers and the file name around the file itself. */
export const MULTIPART_SLACK_BYTES = 64 * 1024;
export const XLSX_MAX_BYTES = 5 * 1024 * 1024;
export const PDF_MAX_BYTES = 20 * 1024 * 1024;

export type UploadRefusal = { status: 400 | 411 | 413; error: "INVALID_CONTENT_LENGTH" | "LENGTH_REQUIRED" | "FILE_TOO_LARGE" };

/**
 * null when a body of this Content-Length may be read for a file of at most `maxFileBytes`.
 * No header (a chunked body) is 411, a header that is not a whole number of bytes is 400, and
 * anything above the file cap plus the multipart slack is 413.
 */
export function uploadRefusal(contentLength: string | null, maxFileBytes: number): UploadRefusal | null {
  if (contentLength === null || contentLength.trim() === "") return { status: 411, error: "LENGTH_REQUIRED" };
  if (!/^\d+$/.test(contentLength.trim())) return { status: 400, error: "INVALID_CONTENT_LENGTH" };
  const bytes = Number(contentLength.trim());
  if (!Number.isSafeInteger(bytes)) return { status: 413, error: "FILE_TOO_LARGE" };
  if (bytes > maxFileBytes + MULTIPART_SLACK_BYTES) return { status: 413, error: "FILE_TOO_LARGE" };
  return null;
}
