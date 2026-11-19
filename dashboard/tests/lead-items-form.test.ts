import { describe, expect, it } from "vitest";
import { fromItems, productText, quotedPriceText, toItemsPayload, type ItemRow } from "@/lib/leads/itemsForm";
import type { OrderItem } from "@/types/api";

const ITEMS: OrderItem[] = [
  { product: "Kertas Supreme 64 gsm cetak 1 warna", size: "30 x 30 cm", qty: 12, qty_unit: "rim", has_design: true },
  { product: "Box ivory", size: "21x14x5", qty: 2500, qty_unit: "pcs", has_design: false },
  { product: "Box nasi", size: "20x20x7,5" },
  { product: "Kertas nasi", qty: 2.5, qty_unit: "rim" },
];

describe("lead items form", () => {
  it("builds the PATCH items from the edit rows", () =>
    expect(
      toItemsPayload([
        { product: " Kertas Supreme 64 gsm cetak 1 warna ", size: "30 x 30 cm", qty: "12", qtyUnit: "rim", design: "yes" },
        { product: "", size: "", qty: "", qtyUnit: "rim", design: "" },
        { product: "Box ivory", size: "21x14x5", qty: "2.500", qtyUnit: "pcs", design: "" },
      ])
    ).toEqual([
      { product: "Kertas Supreme 64 gsm cetak 1 warna", size: "30 x 30 cm", qty: 12, qty_unit: "rim", has_design: true },
      { product: "Box ivory", size: "21x14x5", qty: 2500, qty_unit: "pcs" },
    ]));

  it("round-trips stored items", () => expect(toItemsPayload(fromItems(ITEMS))).toEqual(ITEMS));

  it("shows a stored quantity the way staff type it", () => {
    expect(fromItems(ITEMS).map((r) => r.qty)).toEqual(["12", "2.500", "", "2,5"]);
    expect(fromItems(ITEMS).map((r) => r.design)).toEqual(["yes", "no", "", ""]);
  });

  it("reads a typed quantity: thousands dots, a decimal comma, nothing usable", () => {
    const row = (qty: string): ItemRow => ({ product: "Box", size: "", qty, qtyUnit: "pcs", design: "" });
    expect(toItemsPayload([row("1.234,5"), row("2,5"), row("abc"), row("0"), row(" 3 ")])).toEqual([
      { product: "Box", qty: 1234.5, qty_unit: "pcs" },
      { product: "Box", qty: 2.5, qty_unit: "pcs" },
      { product: "Box" },
      { product: "Box" },
      { product: "Box", qty: 3, qty_unit: "pcs" },
    ]);
  });

  it("puts a stored gsm and print into the product text, as the item is shown", () => {
    expect(productText({ product: "Kertas Supreme", gsm: "64", print: "1 warna" })).toBe("Kertas Supreme 64 gsm cetak 1 warna");
    expect(productText({ product: "Kertas Supreme 64 gsm", gsm: "64 gsm" })).toBe("Kertas Supreme 64 gsm");
    expect(fromItems([{ product: "Kertas Supreme", gsm: "64", size: "30x30" }])[0]).toEqual({
      product: "Kertas Supreme 64 gsm",
      size: "30x30",
      qty: "",
      qtyUnit: "pcs",
      design: "",
    });
  });

  it("formats the quoted price per unit", () => {
    expect(quotedPriceText({ unitPriceIdr: 165000, priceUnit: "rim", totalIdr: 1980000, at: "2026-11-17T02:20:00.000Z" })).toBe(
      "Rp 165.000/rim"
    );
    expect(quotedPriceText({ unitPriceIdr: 1850, priceUnit: "pcs", totalIdr: 4625000, at: "2026-11-17T02:20:00.000Z" })).toBe(
      "Rp 1.850/pcs"
    );
    expect(quotedPriceText(null)).toBe("—");
    expect(quotedPriceText(undefined)).toBe("—");
  });
});
