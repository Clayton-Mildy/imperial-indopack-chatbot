import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch } from "@/lib/api/client";

const reply = (body: BodyInit | null, status: number) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { status }));

describe("apiFetch DELETE", () => {
  afterEach(() => vi.restoreAllMocks());

  it("an empty 200 body reads as no data", async () => {
    reply("", 200);
    await expect(apiFetch("/x/1", { method: "DELETE" })).resolves.toEqual({ data: null, error: null });
  });

  it("a 204 reads as no data", async () => {
    reply(null, 204);
    await expect(apiFetch("/x/1", { method: "DELETE" })).resolves.toEqual({ data: null, error: null });
  });

  it("a JSON envelope is returned (the catalog delete's { sizes, tiers })", async () => {
    reply(JSON.stringify({ data: { sizes: 2, tiers: 4 }, error: null }), 200);
    await expect(apiFetch<{ sizes: number; tiers: number }>("/catalog/products/1", { method: "DELETE" })).resolves.toEqual({
      data: { sizes: 2, tiers: 4 },
      error: null,
    });
  });

  it("an error status throws ApiError with that status, whatever the body", async () => {
    reply(JSON.stringify({ data: null, error: "NOT_FOUND" }), 404);
    const err = await apiFetch("/catalog/products/1", { method: "DELETE" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404 });
  });

  it("an error carries the API's code and details (a number that still has chats)", async () => {
    reply(JSON.stringify({ data: null, error: "NUMBER_HAS_CONVERSATIONS", details: { conversations: 3 } }), 409);
    const err = await apiFetch("/numbers/1", { method: "DELETE" }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 409, code: "NUMBER_HAS_CONVERSATIONS", message: "HTTP 409", details: { conversations: 3 } });
  });

  it("an error with no JSON body is still API_ERROR", async () => {
    reply("Internal Server Error", 500);
    const err = await apiFetch("/numbers/1", { method: "DELETE" }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 500, code: "API_ERROR" });
  });
});
