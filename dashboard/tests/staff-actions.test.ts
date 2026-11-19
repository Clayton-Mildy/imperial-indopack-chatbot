import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Lang } from "@/lib/i18n/core";

// changeOwnPasswordAction's messages follow the language switch (they used to be hardcoded Indonesian).
const m = vi.hoisted(() => ({
  session: vi.fn<() => Promise<unknown>>(),
  patchStaff: vi.fn(),
  lang: { value: "en" as Lang },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: m.session }));
vi.mock("@/lib/api/staff", () => ({ createStaff: vi.fn(), patchStaff: m.patchStaff, deleteStaff: vi.fn() }));
vi.mock("@/lib/api/activityLogs", () => ({ createLog: vi.fn(async () => {}) }));
vi.mock("@/lib/i18n", async () => {
  const core = await vi.importActual<typeof import("@/lib/i18n/core")>("@/lib/i18n/core");
  return { ...core, getT: async () => core.makeT(m.lang.value) };
});

const { changeOwnPasswordAction } = await import("@/actions/staffActions");
const { en } = await import("@/lib/i18n/en");
const { id } = await import("@/lib/i18n/id");

const USER = { user: { id: "11111111-1111-4111-8111-111111111111", name: "Staf Contoh" } };

beforeEach(() => {
  vi.clearAllMocks();
  m.lang.value = "en";
});

describe("changeOwnPasswordAction", () => {
  it.each([["en", en], ["id", id]] as const)("no session: the session message in %s", async (lang, dict) => {
    m.lang.value = lang;
    m.session.mockResolvedValue(null);
    expect(await changeOwnPasswordAction("rahasia-contoh-123")).toEqual({ error: dict["settings.password.sessionInvalid"] });
    expect(m.patchStaff).not.toHaveBeenCalled();
  });

  it.each([["en", en], ["id", id]] as const)("a failed save: the save message in %s", async (lang, dict) => {
    m.lang.value = lang;
    m.session.mockResolvedValue(USER);
    m.patchStaff.mockRejectedValue(new Error("down"));
    expect(await changeOwnPasswordAction("rahasia-contoh-123")).toEqual({ error: dict["settings.password.saveFailed"] });
  });

  it("a saved password: no error", async () => {
    m.session.mockResolvedValue(USER);
    m.patchStaff.mockResolvedValue({});
    expect(await changeOwnPasswordAction("rahasia-contoh-123")).toEqual({});
  });
});
