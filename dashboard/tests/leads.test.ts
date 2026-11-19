import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrandTags } from "@/components/BrandTag";
import type { BrandSlug } from "@/lib/brands";
import { leadsQueryForTab } from "@/lib/leads/tabs";
import { itemLine } from "@/lib/leads/items";
import { CUSTOMER_MESSAGE_KEYS, stripCustomerText } from "@/lib/leads/redact";

describe("leads tabs", () => {
  it("maps tabs to API filters", () => {
    expect(leadsQueryForTab("kertas_supreme", { page: 1 })).toMatchObject({ brand: "kertas_supreme" });
    expect(leadsQueryForTab("imperial_indopack", { page: 1 })).toMatchObject({ brand: "imperial_indopack" });
    expect(leadsQueryForTab("followup", { page: 1 })).toMatchObject({ followUpStatus: "needs_followup" });
    expect(leadsQueryForTab("unreplied", { page: 2, search: "dewi" })).toMatchObject({
      unreplied: true,
      page: 2,
      search: "dewi",
    });
    expect(leadsQueryForTab("all", { page: 1 })).not.toHaveProperty("brand");
  });

  it("passes the shared filters through and omits empty ones", () => {
    const q = leadsQueryForTab("all", { page: 3, startDate: "2026-11-01", endDate: "", status: "won", search: "" });
    expect(q).toEqual({ page: 3, startDate: "2026-11-01", status: "won" });
  });
});

describe("item lines", () => {
  it("formats an item with a quantity", () => {
    expect(itemLine({ product: "Supreme 64 gsm", size: "30x30", qty: 12, qty_unit: "rim" }, "id")).toBe(
      "Supreme 64 gsm 30×30 · 12 rim"
    );
    expect(itemLine({ product: "Box ivory", size: "20x20x7,5", qty: 5000, qty_unit: "pcs" }, "id")).toBe(
      "Box ivory 20×20×7,5 · 5.000 pcs"
    );
  });

  it("says the quantity is missing", () => {
    expect(itemLine({ product: "Box ivory", size: "21x14x5" }, "id")).toBe("Box ivory 21×14×5 · jumlah belum ada");
    expect(itemLine({ product: "Box ivory", size: "21x14x5" }, "en")).toBe("Box ivory 21×14×5 · quantity not set");
  });

  it("does not touch an x inside a word", () => {
    expect(itemLine({ product: "Box xl", size: "25 X 8 x 6", qty: 1, qty_unit: "pcs" }, "id")).toBe(
      "Box xl 25×8×6 · 1 pcs"
    );
  });
});

describe("BrandTags", () => {
  const html = (brands: BrandSlug[]) => renderToStaticMarkup(createElement(BrandTags, { brands }));

  it("renders Kertas Supreme first whatever order is passed, dropping duplicates", () => {
    const out = html(["imperial_indopack", "kertas_supreme", "imperial_indopack"]);
    expect(out.indexOf("Kertas Supreme")).toBeGreaterThan(-1);
    expect(out.indexOf("Kertas Supreme")).toBeLessThan(out.indexOf("Imperial Indopack"));
    expect(out.match(/Imperial Indopack/g)).toHaveLength(1);
  });
});

describe("stripCustomerText", () => {
  it("removes the customer's text from every row", () => {
    const rows = [{ id: "a", outcomeEvidence: "kutipan", firstMessage: "halo" }];
    expect(stripCustomerText(rows)).toEqual([{ id: "a", outcomeEvidence: null, firstMessage: null }]);
  });

  it("removes the follow-up notes (the Leads table's tooltip) when the row carries them", () => {
    const rows = [{ id: "a", outcomeEvidence: null, firstMessage: null, followUpNotes: "pelanggan minta dikirim besok" }];
    expect(stripCustomerText(rows)).toEqual([{ id: "a", outcomeEvidence: null, firstMessage: null, followUpNotes: null }]);
  });

  it("removes the form message the Bukan Lead Pesan column falls back to, and keeps the rest of the form", () => {
    const rows = [
      {
        id: "a",
        outcomeEvidence: null,
        firstMessage: "halo",
        payload: { nama: "Contoh Dewi", apa_yang_anda_butuhkan: "kertas nasi 10 rim" },
      },
    ];
    expect(stripCustomerText(rows)).toEqual([
      { id: "a", outcomeEvidence: null, firstMessage: null, payload: { nama: "Contoh Dewi" } },
    ]);
    for (const key of CUSTOMER_MESSAGE_KEYS) {
      expect(stripCustomerText([{ ...rows[0]!, payload: { [key]: "x" } }])[0]!.payload).toEqual({});
    }
  });
});
