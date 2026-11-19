import { describe, expect, it } from "vitest";
import { defaultPoFormChoice, isPoFormChoice, poFormChoiceKinds, poFormPreview } from "@/lib/conversations/poForms";
import { quickSendLines } from "@/lib/conversations/labels";
import type { PoFormsSetting } from "@/types/api";

const PLACEHOLDER = "https://forms.gle/REPLACE-ME";
const one = (url: string, isPlaceholder = false) => ({ url, isPlaceholder, message: `Untuk pemesanannya, silakan isi form PO berikut ya kak 🙏\n${url}` });
const SETTING: PoFormsSetting = {
  cetak: one("https://forms.gle/ContohCetak"),
  plano: one("https://forms.gle/ContohPlano"),
  both: { message: "Untuk pemesanannya, silakan isi form PO yang sesuai ya kak 🙏\n\n…" },
};

describe("defaultPoFormChoice", () => {
  it("one suggested form is the default; two, none or garbage are both", () => {
    expect(defaultPoFormChoice(["cetak"])).toBe("cetak");
    expect(defaultPoFormChoice(["plano"])).toBe("plano");
    expect(defaultPoFormChoice(["cetak", "plano"])).toBe("both");
    expect(defaultPoFormChoice([])).toBe("both");
    expect(defaultPoFormChoice(undefined)).toBe("both");
    expect(defaultPoFormChoice(["lainnya" as "cetak"])).toBe("both");
  });
});

describe("poFormChoiceKinds / isPoFormChoice", () => {
  it("maps a choice to the forms it sends", () => {
    expect(poFormChoiceKinds("cetak")).toEqual(["cetak"]);
    expect(poFormChoiceKinds("plano")).toEqual(["plano"]);
    expect(poFormChoiceKinds("both")).toEqual(["cetak", "plano"]);
  });

  it("only the three choices are valid", () => {
    for (const v of ["cetak", "plano", "both"]) expect(isPoFormChoice(v)).toBe(true);
    for (const v of ["", "Cetak", "keduanya", undefined, null, 1, {}]) expect(isPoFormChoice(v)).toBe(false);
  });
});

describe("poFormPreview", () => {
  it("shows the exact message the choice sends", () => {
    expect(poFormPreview(SETTING, "cetak")).toEqual({ ok: true, message: SETTING.cetak.message });
    expect(poFormPreview(SETTING, "plano")).toEqual({ ok: true, message: SETTING.plano.message });
    expect(poFormPreview(SETTING, "both")).toEqual({ ok: true, message: SETTING.both.message });
  });

  it("a chosen form still on the placeholder cannot be sent; the other form alone still can", () => {
    const planoUnset = { ...SETTING, plano: one(PLACEHOLDER, true) };
    expect(poFormPreview(planoUnset, "plano")).toEqual({ ok: false, unset: ["plano"] });
    expect(poFormPreview(planoUnset, "both")).toEqual({ ok: false, unset: ["plano"] });
    expect(poFormPreview(planoUnset, "cetak")).toEqual({ ok: true, message: SETTING.cetak.message });
    const noneSet = { ...SETTING, cetak: one(PLACEHOLDER, true), plano: one(PLACEHOLDER, true) };
    expect(poFormPreview(noneSet, "both")).toEqual({ ok: false, unset: ["cetak", "plano"] });
  });
});

describe("quickSendLines for the PO form", () => {
  const sent = [{ messageId: "m1", kind: "text" as const, status: "sent" as const }];
  it("names the form that went", () => {
    expect(quickSendLines({ kind: "po_form", form: "cetak" }, sent, "id")).toEqual(["Form PO cetak terkirim"]);
    expect(quickSendLines({ kind: "po_form", form: "plano" }, sent, "en")).toEqual(["Plano PO form sent"]);
    expect(quickSendLines({ kind: "po_form", form: "both" }, sent, "id")).toEqual(["Form PO cetak & plano terkirim"]);
    expect(quickSendLines({ kind: "po_form" }, sent, "id")).toEqual(["Form PO terkirim"]);
  });
});
