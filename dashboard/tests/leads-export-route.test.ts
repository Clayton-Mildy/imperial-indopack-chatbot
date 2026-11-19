import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The export proxy knows the session's role; a read-only (marketing) session always gets the redacted
// file (redact=1: no customer text), whatever the browser put in the query string.

const m = vi.hoisted(() => ({ readOnly: vi.fn<() => Promise<boolean>>() }));
vi.mock("@/lib/session", () => ({ isReadOnly: m.readOnly }));

const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "application/octet-stream" } }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

async function forwarded(query: string): Promise<URL> {
  const { GET } = await import("@/app/api/leads-export/route");
  const res = await GET(new NextRequest(`http://localhost:40070/app/api/leads-export${query}`));
  expect(res.status).toBe(200);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  return new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
}

describe("GET /api/leads-export", () => {
  it("a read-only session gets redact=1 and keeps its filters", async () => {
    m.readOnly.mockResolvedValue(true);
    const url = await forwarded("?status=won&startDate=2026-11-01");
    expect(url.pathname).toBe("/api/v1/leads/export");
    expect(url.searchParams.get("redact")).toBe("1");
    expect(url.searchParams.get("status")).toBe("won");
    expect(url.searchParams.get("startDate")).toBe("2026-11-01");
  });

  it("a read-only session cannot turn redact off from the browser", async () => {
    m.readOnly.mockResolvedValue(true);
    const url = await forwarded("?redact=0&redact=0");
    expect(url.searchParams.getAll("redact")).toEqual(["1"]);
  });

  it("an admin or agent session gets the whole file; a browser-sent redact is dropped", async () => {
    m.readOnly.mockResolvedValue(false);
    const url = await forwarded("?status=won&redact=1");
    expect(url.searchParams.has("redact")).toBe(false);
    expect(url.searchParams.get("status")).toBe("won");
  });
});
