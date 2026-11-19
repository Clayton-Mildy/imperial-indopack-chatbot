import { describe, expect, it } from "vitest";
import { fromItems, productText, quotedPriceText, rowProblems, toItemsPayload, type ItemRow } from "@/lib/leads/itemsForm";
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
      { product: "Box", qty_unit: "pcs" },
      { product: "Box", qty_unit: "pcs" },
      { product: "Box", qty: 3, qty_unit: "pcs" },
    ]);
  });

  it("shows a stored gsm and print in the product text", () => {
    expect(productText({ product: "Kertas Supreme", gsm: "64", print: "1 warna" })).toBe("Kertas Supreme 64 gsm cetak 1 warna");
    expect(productText({ product: "Kertas Supreme 64 gsm", gsm: "64 gsm" })).toBe("Kertas Supreme 64 gsm");
    expect(productText({ product: "Kertas Supreme 64gsm", gsm: "64" })).toBe("Kertas Supreme 64gsm");
    expect(fromItems([{ product: "Kertas Supreme", gsm: "64", size: "30x30" }])[0]).toMatchObject({
      product: "Kertas Supreme 64 gsm",
      size: "30x30",
      qty: "",
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

// Ubah then Simpan with nothing touched must send back exactly what is stored: the save also sets the
// staff lock, so any drift would be frozen in for good.
describe("lead items form: lossless round trip", () => {
  it("leaves untouched items exactly as stored: gsm and print, a unit without a quantity, a quantity without a unit", () => {
    const stored: OrderItem[] = [
      { product: "Kertas Supreme", gsm: "64", print: "1 warna", size: "30x30", qty: 12, qty_unit: "rim", has_design: true },
      { product: "Box ivory", size: "21x14x5", qty_unit: "pcs" },
      { product: "Box nasi", size: "20x20x7", qty: 3000 },
      { qty_unit: "rim" },
    ];
    expect(toItemsPayload(fromItems(stored))).toEqual(stored);
  });

  it("never loses a gsm the product name only seems to contain ('Box 640' and 64 gsm)", () => {
    const stored: OrderItem = { product: "Box 640", gsm: "64", size: "20x20" };
    expect(productText(stored)).toBe("Box 640 64 gsm");
    const [row] = fromItems([stored]);
    expect(toItemsPayload([row!])).toEqual([stored]);
    expect(toItemsPayload([{ ...row!, product: `${row!.product} tebal` }])).toEqual([{ product: "Box 640 64 gsm tebal", size: "20x20" }]);
  });

  it("keeps the stored product, gsm and print when only another field changes", () => {
    const [row] = fromItems([{ product: "Kertas Supreme", gsm: "64", print: "1 warna", size: "30x30", qty: 12, qty_unit: "rim" }]);
    expect(toItemsPayload([{ ...row!, qty: "20" }])).toEqual([
      { product: "Kertas Supreme", gsm: "64", print: "1 warna", size: "30x30", qty: 20, qty_unit: "rim" },
    ]);
  });

  it("folds gsm and print into the text only when staff edit the product", () => {
    const [row] = fromItems([{ product: "Kertas Supreme", gsm: "64", print: "1 warna", size: "30x30" }]);
    expect(toItemsPayload([{ ...row!, product: "Kertas Supreme 64 gsm cetak 2 warna" }])).toEqual([
      { product: "Kertas Supreme 64 gsm cetak 2 warna", size: "30x30" },
    ]);
  });

  it("keeps a stored quantity without a unit unit-less until staff pick one", () => {
    const [row] = fromItems([{ product: "Box nasi", qty: 3000 }]);
    expect(row!.noUnit).toBe(true);
    expect(toItemsPayload([{ ...row!, qty: "4.000" }])).toEqual([{ product: "Box nasi", qty: 4000 }]);
    expect(toItemsPayload([{ ...row!, qtyUnit: "pcs", noUnit: false }])).toEqual([{ product: "Box nasi", qty: 3000, qty_unit: "pcs" }]);
  });

  it("drops a stored item staff blanked out", () => {
    const [row] = fromItems([{ product: "Box nasi", size: "20x20", qty: 10, qty_unit: "pcs" }]);
    expect(toItemsPayload([{ ...row!, product: "", size: "", qty: "" }])).toEqual([]);
  });
});

describe("lead items form: field problems", () => {
  it("flags a product the API would refuse (over 200 characters), by row", () => {
    const long = "x".repeat(195);
    const [row] = fromItems([{ product: long, gsm: "64", print: "1 warna" }]);
    // As stored it is fine: the stored product goes back untouched.
    expect(rowProblems([row!])).toEqual([]);
    // Edited, the folded text is what gets sent, and it is too long.
    expect(rowProblems([{ product: "Box", size: "", qty: "", qtyUnit: "pcs", design: "" }, { ...row!, product: `${row!.product}!` }])).toEqual([
      { row: 1, field: "product" },
    ]);
    expect(rowProblems([{ product: "Box", size: "y".repeat(101), qty: "", qtyUnit: "pcs", design: "" }])).toEqual([{ row: 0, field: "size" }]);
  });
});
