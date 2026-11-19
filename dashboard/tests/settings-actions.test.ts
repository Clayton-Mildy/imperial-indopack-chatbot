import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import type { BotSettings, PhoneNumber } from "@/types/api";

// The server actions with the Next runtime and the API mocked: what is checked here is the admin gate,
// the range checks and what reaches the API and the activity log.
const m = vi.hoisted(() => ({
  role: vi.fn<() => Promise<string | null>>(),
  patchBotSettings: vi.fn(),
  setPoFormUrl: vi.fn(),
  getNumbers: vi.fn(),
  patchNumber: vi.fn(),
  createLog: vi.fn(async (_entry: { message: string; performedBy: string; entityType?: string; entityId?: string }) => {}),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));
vi.mock("@/lib/session", () => ({ sessionRole: m.role, sessionStaff: async () => ({ staffName: "Staf Contoh" }) }));
vi.mock("@/lib/api/activityLogs", () => ({ createLog: m.createLog }));
vi.mock("@/lib/api/settings", () => ({
  patchBotSettings: m.patchBotSettings,
  setPoFormUrl: m.setPoFormUrl,
  setLeadReopenMonths: vi.fn(),
  setLeadSilenceDays: vi.fn(),
}));
vi.mock("@/lib/api/numbers", () => ({ getNumbers: m.getNumbers, patchNumber: m.patchNumber }));

const { saveBotSettingsAction, savePoFormUrlAction, replaceNumberPromptAction } = await import("@/actions/settingsActions");

const SETTINGS: BotSettings = {
  botName: "Mbak Contoh",
  signAs: "brand_discussed",
  greeting: "Halo kak, terima kasih sudah menghubungi {merek}.",
  fallbackMinPcs: 2500,
  teamReminderMinutes: 30,
  whatsappSyncMinutes: 60,
};

const NUMBER: PhoneNumber = {
  id: "11111111-1111-4111-8111-111111111111",
  number: "6281200000070",
  label: "CS Contoh",
  wabaId: "1",
  phoneNumberId: "1",
  customSystemPrompt: null,
  promptSections: [{ name: "Identity", content: "Instruksi lama contoh" }],
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  m.role.mockResolvedValue("admin");
  m.patchBotSettings.mockResolvedValue(SETTINGS);
  m.getNumbers.mockResolvedValue([NUMBER]);
  m.patchNumber.mockResolvedValue({ ...NUMBER, promptSections: null });
});

describe("saveBotSettingsAction", () => {
  it.each(["agent", "marketing", null])("refuses a %s session without calling the API", async (role) => {
    m.role.mockResolvedValue(role);
    expect(await saveBotSettingsAction({ teamReminderMinutes: 30 })).toEqual({ ok: false, error: "forbidden" });
    expect(m.patchBotSettings).not.toHaveBeenCalled();
    expect(m.createLog).not.toHaveBeenCalled();
  });

  it.each([
    [{ teamReminderMinutes: 4 }],
    [{ teamReminderMinutes: 1441 }],
    [{ whatsappSyncMinutes: -1 }],
    [{ fallbackMinPcs: 0 }],
    [{ fallbackMinPcs: 2.5 }],
    [{ botName: "   " }],
    [{ botName: "x".repeat(41) }],
    [{ greeting: "" }],
    [{ signAs: "kertas_supreme" as BotSettings["signAs"] }],
    [{ unknownField: 1 } as Partial<BotSettings>],
    [{}],
  ])("refuses %j before the API", async (patch) => {
    expect(await saveBotSettingsAction(patch)).toEqual({ ok: false, error: "invalid" });
    expect(m.patchBotSettings).not.toHaveBeenCalled();
  });

  it("sends trimmed fields at the range edges, returns the stored settings and logs in the session's name", async () => {
    const res = await saveBotSettingsAction({ botName: "  Mbak Contoh  ", teamReminderMinutes: 5, whatsappSyncMinutes: 0 });
    expect(res).toEqual({ ok: true, settings: SETTINGS });
    expect(m.patchBotSettings).toHaveBeenCalledWith({ botName: "Mbak Contoh", teamReminderMinutes: 5, whatsappSyncMinutes: 0 });
    expect(m.revalidatePath).toHaveBeenCalledWith("/settings");
    expect(m.createLog).toHaveBeenCalledWith(expect.objectContaining({ performedBy: "Staf Contoh", entityType: "settings" }));
  });

  it("an API 400 is invalid; anything else failed", async () => {
    m.patchBotSettings.mockRejectedValueOnce(new ApiError(400, "API_ERROR", "VALIDATION_ERROR"));
    expect(await saveBotSettingsAction({ teamReminderMinutes: 30 })).toEqual({ ok: false, error: "invalid" });
    m.patchBotSettings.mockRejectedValueOnce(new Error("network"));
    expect(await saveBotSettingsAction({ teamReminderMinutes: 30 })).toEqual({ ok: false, error: "failed" });
  });
});

describe("savePoFormUrlAction", () => {
  it("checks the link before the API: http is not_https, junk is invalid, an unknown form is invalid", async () => {
    expect(await savePoFormUrlAction("cetak", "http://forms.gle/contoh")).toEqual({ ok: false, error: "not_https" });
    expect(await savePoFormUrlAction("plano", "forms.gle")).toEqual({ ok: false, error: "invalid" });
    expect(await savePoFormUrlAction("lainnya" as "cetak", "https://forms.gle/contoh")).toEqual({ ok: false, error: "invalid" });
    expect(m.setPoFormUrl).not.toHaveBeenCalled();
  });

  it("refuses a non-admin", async () => {
    m.role.mockResolvedValue("agent");
    expect(await savePoFormUrlAction("cetak", "https://forms.gle/contoh")).toEqual({ ok: false, error: "forbidden" });
    expect(m.setPoFormUrl).not.toHaveBeenCalled();
  });
});

describe("replaceNumberPromptAction", () => {
  it("refuses a non-admin without touching the number", async () => {
    m.role.mockResolvedValue("agent");
    expect(await replaceNumberPromptAction(NUMBER.id)).toEqual({ ok: false, error: "forbidden" });
    expect(m.patchNumber).not.toHaveBeenCalled();
  });

  it("refuses a number that does not exist", async () => {
    expect(await replaceNumberPromptAction("22222222-2222-4222-8222-222222222222")).toEqual({ ok: false, error: "invalid" });
    expect(m.patchNumber).not.toHaveBeenCalled();
  });

  it("puts the number on the shared instructions and logs which number, in the session's name", async () => {
    expect(await replaceNumberPromptAction(NUMBER.id)).toEqual({ ok: true });
    expect(m.patchNumber).toHaveBeenCalledWith(NUMBER.id, { promptSections: null });
    expect(m.revalidatePath).toHaveBeenCalledWith("/settings");
    const log = m.createLog.mock.calls[0]![0];
    expect(log.performedBy).toBe("Staf Contoh");
    expect(log).toMatchObject({ entityType: "phoneNumber", entityId: NUMBER.id });
    expect(log.message).toContain("CS Contoh");
    expect(log.message).toContain("instruksi bersama");
  });

  it("an API failure is failed and nothing is logged", async () => {
    m.patchNumber.mockRejectedValueOnce(new Error("network"));
    expect(await replaceNumberPromptAction(NUMBER.id)).toEqual({ ok: false, error: "failed" });
    expect(m.createLog).not.toHaveBeenCalled();
  });
});
