import { describe, expect, it } from "vitest";
import {
  MULTIPART_SLACK_BYTES,
  PDF_MAX_BYTES,
  XLSX_MAX_BYTES,
  readCappedFormData,
  uploadRefusal,
} from "@/lib/uploadLimit";

/** A one-file multipart body, as the browser would send it. */
async function multipart(size: number, name = "daftar-harga.pdf") {
  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array(size).fill(37)], { type: "application/pdf" }), name);
  const res = new Response(fd);
  return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type")! };
}

/** The bytes as a chunked stream (no Content-Length, as Cloudflare may forward it); counts the chunks pulled. */
function chunked(bytes: Uint8Array, chunkSize = 16 * 1024) {
  const seen = { pulled: 0, total: Math.ceil(bytes.byteLength / chunkSize) };
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) return controller.close();
      seen.pulled++;
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
  return { stream, seen };
}

function request(body: BodyInit | null, headers: Record<string, string>): Request {
  return new Request("http://localhost/app/api/brand-price-list/kertas_supreme", {
    method: "POST",
    body,
    headers,
    duplex: "half",
  } as RequestInit);
}

describe("upload size guard: Content-Length header", () => {
  it("lets a body up to the file cap plus the multipart slack through", () => {
    expect(uploadRefusal("12345", XLSX_MAX_BYTES)).toBeNull();
    expect(uploadRefusal(String(XLSX_MAX_BYTES + MULTIPART_SLACK_BYTES), XLSX_MAX_BYTES)).toBeNull();
    expect(uploadRefusal(String(PDF_MAX_BYTES), PDF_MAX_BYTES)).toBeNull();
  });

  it("refuses an oversized body with 413 before it is read", () => {
    expect(uploadRefusal(String(XLSX_MAX_BYTES + MULTIPART_SLACK_BYTES + 1), XLSX_MAX_BYTES)).toEqual({ status: 413, error: "FILE_TOO_LARGE" });
    expect(uploadRefusal(String(25 * 1024 * 1024), PDF_MAX_BYTES)).toEqual({ status: 413, error: "FILE_TOO_LARGE" });
    expect(uploadRefusal("99999999999999999999999", PDF_MAX_BYTES)).toEqual({ status: 413, error: "FILE_TOO_LARGE" });
  });

  it("refuses a malformed Content-Length with 400", () => {
    expect(uploadRefusal("-5", PDF_MAX_BYTES)).toEqual({ status: 400, error: "INVALID_CONTENT_LENGTH" });
    expect(uploadRefusal("1e6", PDF_MAX_BYTES)).toEqual({ status: 400, error: "INVALID_CONTENT_LENGTH" });
    expect(uploadRefusal("12.5", PDF_MAX_BYTES)).toEqual({ status: 400, error: "INVALID_CONTENT_LENGTH" });
  });

  it("gives no verdict when the header is absent: the body is then counted while it is read", () => {
    expect(uploadRefusal(null, PDF_MAX_BYTES)).toBeNull();
    expect(uploadRefusal("", PDF_MAX_BYTES)).toBeNull();
  });
});

describe("readCappedFormData", () => {
  it("with a Content-Length within the cap, parses the form", async () => {
    const { bytes, contentType } = await multipart(2000);
    const res = await readCappedFormData(
      request(bytes, { "content-type": contentType, "content-length": String(bytes.byteLength) }),
      PDF_MAX_BYTES
    );
    expect(res.ok).toBe(true);
    const file = res.ok ? res.formData.get("file") : null;
    expect(file).toBeInstanceOf(File);
    expect(file).toMatchObject({ name: "daftar-harga.pdf", size: 2000 });
  });

  it("with a Content-Length over the cap, answers 413 without reading the body", async () => {
    const { bytes, contentType } = await multipart(10);
    const req = request(bytes, { "content-type": contentType, "content-length": String(PDF_MAX_BYTES + MULTIPART_SLACK_BYTES + 1) });
    expect(await readCappedFormData(req, PDF_MAX_BYTES)).toEqual({ ok: false, status: 413, error: "FILE_TOO_LARGE" });
    expect(req.bodyUsed).toBe(false);
  });

  it("with a malformed Content-Length, answers 400", async () => {
    const { bytes, contentType } = await multipart(10);
    expect(await readCappedFormData(request(bytes, { "content-type": contentType, "content-length": "abc" }), PDF_MAX_BYTES)).toEqual({
      ok: false,
      status: 400,
      error: "INVALID_CONTENT_LENGTH",
    });
  });

  it("without a Content-Length, a small chunked body is accepted and parsed", async () => {
    const { bytes, contentType } = await multipart(40_000);
    const { stream } = chunked(bytes);
    const req = request(stream, { "content-type": contentType });
    expect(req.headers.get("content-length")).toBeNull();
    const res = await readCappedFormData(req, PDF_MAX_BYTES);
    expect(res.ok).toBe(true);
    expect(res.ok ? res.formData.get("file") : null).toMatchObject({ name: "daftar-harga.pdf", size: 40_000 });
  });

  it("without a Content-Length, an oversized chunked body is 413 and reading stops at the cap", async () => {
    const cap = 1000; // file cap; the body may be cap + slack (64 KB) at most
    const { bytes, contentType } = await multipart(400_000);
    const { stream, seen } = chunked(bytes);
    const res = await readCappedFormData(request(stream, { "content-type": contentType }), cap);
    expect(res).toEqual({ ok: false, status: 413, error: "FILE_TOO_LARGE" });
    expect(seen.pulled).toBeLessThan(seen.total);
  });

  it("a body that is not multipart is 400", async () => {
    const { stream } = chunked(new TextEncoder().encode("not a form"));
    expect(await readCappedFormData(request(stream, { "content-type": "multipart/form-data; boundary=x" }), PDF_MAX_BYTES)).toEqual({
      ok: false,
      status: 400,
      error: "INVALID_FORM_DATA",
    });
  });
});
