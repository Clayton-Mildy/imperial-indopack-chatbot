import { PCS_PER_RIM } from "@/lib/format";
import type { CatalogProduct, PriceTier, QtyUnit } from "@/types/api";

// The Katalog card's price table: one row per size, one column per quantity tier any size has.

export interface TierColumn {
  minQty: number;
  qtyUnit: QtyUnit;
}

type Size = CatalogProduct["sizes"][number];

const toPcs = (c: TierColumn): number => (c.qtyUnit === "rim" ? c.minQty * PCS_PER_RIM : c.minQty);
const sameColumn = (a: TierColumn, b: TierColumn): boolean => a.minQty === b.minQty && a.qtyUnit === b.qtyUnit;

/**
 * The distinct (minQty, qtyUnit) pairs over every size, ascending by pcs. "5 rim" and "2500 pcs" are
 * one threshold written two ways and stay two columns (rim first), so each cell shows what was typed.
 */
export function tierColumns(sizes: Size[]): TierColumn[] {
  const columns: TierColumn[] = [];
  for (const size of sizes) {
    for (const t of size.tiers) {
      if (!columns.some((c) => sameColumn(c, t))) columns.push({ minQty: t.minQty, qtyUnit: t.qtyUnit });
    }
  }
  return columns.sort((a, b) => toPcs(a) - toPcs(b) || (a.qtyUnit === b.qtyUnit ? 0 : a.qtyUnit === "rim" ? -1 : 1));
}

/** The size's tier at exactly this column, or null (the table shows "—"). */
export function cellFor(size: Size, col: TierColumn): PriceTier | null {
  return size.tiers.find((t) => sameColumn(t, col)) ?? null;
}

/** Whether the size's prices include delivery: every tier, none (or no tiers at all), or some. */
export function deliveryLabel(size: Size): "included" | "excluded" | "mixed" {
  const included = size.tiers.filter((t) => t.includesDelivery).length;
  if (included === 0) return "excluded";
  return included === size.tiers.length ? "included" : "mixed";
}

/** The size cell of a card row: the size, then its gramasi when the product has gramasi ("20 x 20 x 7,5 cm · 270 gsm"). */
export function sizeRowLabel(size: Pick<Size, "size" | "gsm">): string {
  return size.gsm ? `${size.size} · ${size.gsm}` : size.size;
}

/** The API's normalizeSize: "20 x 20 x 7,5 cm" and "20x20x7.5" are one size. */
const sizeKey = (s: string): string =>
  s.toLowerCase().replace(/[×*]/g, "x").replace(/cm/g, "").replace(/,/g, ".").replace(/\s+/g, "");

/** How many sizes a product has - one size under several gramasi counts once. */
export function distinctSizeCount(sizes: Pick<Size, "size">[]): number {
  return new Set(sizes.map((s) => sizeKey(s.size))).size;
}
