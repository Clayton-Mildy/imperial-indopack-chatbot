import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";

// removeNumber with the Next runtime, the session and the API mocked: a number that still has chats is
// refused with a message that says how many (live 2026-11-20: the page swallowed a bare HTTP 500).
const m = vi.hoisted(() => ({
  role: vi.fn<() => Promise<string>>(async () => "admin"),
  deleteNumber: vi.fn(),
  createLog: vi.fn(async () => {}),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { name: "Admin Contoh", role: await m.role() } }) }));
vi.mock("@/lib/api/activityLogs", () => ({ createLog: m.createLog }));
vi.mock("@/lib/api/numbers", () => ({ createNumber: vi.fn(), patchNumber: vi.fn(), deleteNumber: m.deleteNumber }));
vi.mock("@/lib/i18n", async () => {
  const core = await vi.importActual<typeof import("@/lib/i18n/core")>("@/lib/i18n/core");
  return { ...core, getT: async () => core.makeT("en") };
});

const { removeNumber } = await import("@/actions/numberActions");

describe("removeNumber", () => {
  beforeEach(() => { vi.clearAllMocks(); m.role.mockResolvedValue("admin"); });

  it("deletes, refreshes the page and logs it", async () => {
    m.deleteNumber.mockResolvedValue(undefined);
    expect(await removeNumber("11111111-1111-4111-8111-111111111111")).toEqual({ ok: true });
    expect(m.revalidatePath).toHaveBeenCalledWith("/numbers");
    expect(m.createLog).toHaveBeenCalledTimes(1);
  });

  it("a number that still has chats says how many, and nothing is logged", async () => {
    m.deleteNumber.mockRejectedValue(new ApiError(409, "NUMBER_HAS_CONVERSATIONS", "HTTP 409", { conversations: 3 }));
    expect(await removeNumber("11111111-1111-4111-8111-111111111111"))
      .toEqual({ ok: false, error: "This number cannot be deleted: it is still used in 3 conversations." });
    expect(m.createLog).not.toHaveBeenCalled();
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it("any other failure gives the generic delete message", async () => {
    m.deleteNumber.mockRejectedValue(new ApiError(500, "API_ERROR", "HTTP 500"));
    expect(await removeNumber("11111111-1111-4111-8111-111111111111"))
      .toEqual({ ok: false, error: "The number could not be deleted. Please try again." });
  });

  it("a non-admin is refused before the API is called", async () => {
    m.role.mockResolvedValue("staff");
    expect((await removeNumber("11111111-1111-4111-8111-111111111111")).ok).toBe(false);
    expect(m.deleteNumber).not.toHaveBeenCalled();
  });
});
