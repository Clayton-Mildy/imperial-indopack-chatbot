import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Every id the dashboard puts into an API path is checked (uuid) and encoded before anything is
// forwarded: a "../catalog/import?" from a query string, a decoded route param or a server-action
// argument would otherwise walk the path to another, possibly admin-only, API endpoint.

const m = vi.hoisted(() => ({
  role: vi.fn<() => Promise<string | null>>(),
}));

vi.mock("@/lib/session", () => ({
  sessionRole: m.role,
  sessionStaff: async () => ({ staffName: "Staf Contoh" }),
  isReadOnly: async () => (await m.role()) === "marketing",
}));

const ID = "11111111-1111-4111-8111-111111111111";
const TRAVERSALS = ["..%2Fcatalog%2Fimport%3F", "../catalog/import?", "..", "%2e%2e", "../numbers", "", "not-a-uuid"];

const fetchMock = vi.fn(async () => Response.json({ data: { ok: true }, error: null }));

beforeEach(() => {
  vi.clearAllMocks();
  m.role.mockResolvedValue("admin");
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function pdfForm(name = "contoh.pdf", type = "application/pdf") {
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array(16).fill(37)], name, { type }));
  return fd;
}

describe("pathId / isUuid", () => {
  it("passes a uuid through and refuses anything else with ApiError(404)", async () => {
    const { pathId, ApiError } = await import("@/lib/api/client");
    expect(pathId(ID)).toBe(ID);
    for (const bad of [...TRAVERSALS, decodeURIComponent(TRAVERSALS[0]!), undefined, null, 42]) {
      let err: unknown;
      try {
        pathId(bad);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).status).toBe(404);
    }
  });
});

describe("lib/api helpers never forward a non-uuid id", () => {
  const BAD = "../numbers";
  it.each([
    ["getLeadDetail", async () => (await import("@/lib/api/leads")).getLeadDetail(BAD)],
    ["patchLead", async () => (await import("@/lib/api/leads")).patchLead(BAD, { notes: "x" } as never)],
    ["patchNumber", async () => (await import("@/lib/api/numbers")).patchNumber(BAD, { label: "x" })],
    ["deleteNumber", async () => (await import("@/lib/api/numbers")).deleteNumber(BAD)],
    ["patchStaff", async () => (await import("@/lib/api/staff")).patchStaff(BAD, { displayName: "x" })],
    ["deleteStaff", async () => (await import("@/lib/api/staff")).deleteStaff(BAD)],
    ["getConversation", async () => (await import("@/lib/api/conversations")).getConversation(BAD)],
    ["patchConversation", async () => (await import("@/lib/api/conversations")).patchConversation("..", { status: "active" })],
    ["getOrderPanel", async () => (await import("@/lib/api/conversations")).getOrderPanel(BAD)],
    ["saveTeamNotes", async () => (await import("@/lib/api/conversations")).saveTeamNotes(BAD, "x", "Staf")],
    ["quickSend", async () => (await import("@/lib/api/conversations")).quickSend(BAD, { kind: "po_form" } as never, "Staf")],
    ["getCatalogProductDetail", async () => (await import("@/lib/api/catalog")).getCatalogProductDetail(BAD)],
    ["setCatalogProductActive", async () => (await import("@/lib/api/catalog")).setCatalogProductActive("..", true, { staffName: "Staf" })],
    ["deleteCatalogProduct", async () => (await import("@/lib/api/catalog")).deleteCatalogProduct(BAD, { staffName: "Staf" })],
    ["saveCatalogProduct", async () => (await import("@/lib/api/catalog")).saveCatalogProduct("..", {} as never, { staffName: "Staf" })],
    ["deleteReferenceImage", async () => (await import("@/lib/api/catalog")).deleteReferenceImage(BAD)],
  ])("%s refuses with 404 and calls nothing", async (_name, call) => {
    await expect(call()).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a uuid still reaches the API at its own path", async () => {
    await (await import("@/lib/api/numbers")).deleteNumber(ID);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toMatch(new RegExp(`/api/v1/numbers/${ID}$`));
  });
});

describe("POST /api/upload-attachment", () => {
  it.each(TRAVERSALS)("refuses conversationId %j with 400 and forwards nothing", async (bad) => {
    const { POST } = await import("@/app/api/upload-attachment/route");
    const url = `http://localhost:40070/app/api/upload-attachment?conversationId=${bad.includes("%") ? bad : encodeURIComponent(bad)}`;
    const res = await POST(new NextRequest(url, { method: "POST", body: pdfForm() }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards a uuid to that conversation's attachments", async () => {
    const { POST } = await import("@/app/api/upload-attachment/route");
    const res = await POST(new NextRequest(`http://localhost:40070/app/api/upload-attachment?conversationId=${ID}`, { method: "POST", body: pdfForm() }));
    expect(res.status).toBe(200);
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(url.pathname).toBe(`/api/v1/conversations/${ID}/attachments`);
    expect(url.searchParams.get("senderName")).toBe("Staf Contoh");
  });
});

describe("POST/DELETE /api/brand-price-list/:slug", () => {
  it.each(["..%2Fcatalog%2Fimport%3F", "../catalog/import?", "..", "kertas_supreme/../../catalog"])(
    "refuses slug %j with 404 and forwards nothing",
    async (slug) => {
      const { POST, DELETE } = await import("@/app/api/brand-price-list/[slug]/route");
      const req = () => new NextRequest("http://localhost:40070/app/api/brand-price-list/x", { method: "POST", body: pdfForm() });
      expect((await POST(req(), { params: Promise.resolve({ slug }) })).status).toBe(404);
      expect((await DELETE(req(), { params: Promise.resolve({ slug }) })).status).toBe(404);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );
});

describe("POST /api/reference-images/:productId", () => {
  it.each(TRAVERSALS)("refuses productId %j with 404 and forwards nothing", async (productId) => {
    const { POST } = await import("@/app/api/reference-images/[productId]/route");
    const req = new NextRequest("http://localhost:40070/app/api/reference-images/x", { method: "POST", body: pdfForm("contoh.png", "image/png") });
    expect((await POST(req, { params: Promise.resolve({ productId }) })).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the dead GET /api/conversation/:id proxy", () => {
  it("is gone (Next decodes route params, so ..%2Fnumbers reached any API GET)", async () => {
    await expect(import("@/app/api/conversation/[id]/route" as string)).rejects.toThrow();
  });
});
