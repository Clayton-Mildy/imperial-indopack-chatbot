import { describe, expect, it } from "vitest";
import { cellFor, deliveryLabel, tierColumns } from "@/lib/catalog/tierTable";
import type { CatalogProduct, PriceTier } from "@/types/api";

type Size = CatalogProduct["sizes"][number];

const T = (
  minQty: number,
  qtyUnit: "rim" | "pcs",
  priceIdr: number,
  includesDelivery: boolean,
  priceUnit: "rim" | "pcs" = "pcs"
): PriceTier => ({ minQty, qtyUnit, priceIdr, priceUnit, includesDelivery, note: null });
let nextId = 0;
const S = (size: string, tiers: PriceTier[]): Size => ({ id: `size-${++nextId}`, size, tiers });

const SIZES = [
  S("21 x 7 x 5 cm", [T(5, "rim", 1500, true), T(10, "rim", 1300, true)]),
  S("21 x 14 x 5 cm", [T(5, "rim", 1900, true), T(20, "rim", 1200, false)]),
];

describe("tier table", () => {
  it("columns are the union of tier minimums, ascending", () =>
    expect(tierColumns(SIZES)).toEqual([
      { minQty: 5, qtyUnit: "rim" },
      { minQty: 10, qtyUnit: "rim" },
      { minQty: 20, qtyUnit: "rim" },
    ]));

  it("a missing cell is null", () => expect(cellFor(SIZES[0]!, { minQty: 20, qtyUnit: "rim" })).toBeNull());

  it("delivery label", () => {
    expect(deliveryLabel(SIZES[0]!)).toBe("included");
    expect(deliveryLabel(SIZES[1]!)).toBe("mixed");
  });

  it("orders columns by pcs across units, and finds the matching cell", () => {
    const sizes = [S("30x30", [T(2500, "pcs", 1234, false), T(10, "rim", 999, false)]), S("25x25", [T(3, "rim", 1400, false)])];
    expect(tierColumns(sizes)).toEqual([
      { minQty: 3, qtyUnit: "rim" },
      { minQty: 2500, qtyUnit: "pcs" },
      { minQty: 10, qtyUnit: "rim" },
    ]);
    expect(cellFor(sizes[0]!, { minQty: 10, qtyUnit: "rim" })?.priceIdr).toBe(999);
    // Same threshold in another unit is another column, never a match.
    expect(cellFor(sizes[0]!, { minQty: 5, qtyUnit: "rim" })).toBeNull();
    expect(deliveryLabel(sizes[0]!)).toBe("excluded");
  });
});
