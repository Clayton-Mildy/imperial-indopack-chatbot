import { PCS_PER_RIM } from "@/lib/format";
import type { CatalogProduct, PriceTier, QtyUnit } from "@/types/api";

// The Katalog card's price table: one row per size, one column per quantity tier any size has.

export interface TierColumn {
  minQty: number;
  qtyUnit: QtyUnit;
  /** Sizes wrote this threshold in both units ("5 rim" on one, "2.500 pcs" on another): the header shows both. */
  mixed?: boolean;
}

type Size = CatalogProduct["sizes"][number];

const toPcs = (c: Pick<TierColumn, "minQty" | "qtyUnit">): number => (c.qtyUnit === "rim" ? c.minQty * PCS_PER_RIM : c.minQty);

/**
 * One column per quantity threshold over every size, ascending. "5 rim" and "2.500 pcs" are the same
 * threshold (1 rim = 500 pcs), so they share a column (live 2026-11-20: side by side, each half empty).
 * The header uses rim when any size wrote it in rim, and is marked `mixed` when both units were used.
 */
export function tierColumns(sizes: Size[]): TierColumn[] {
  const byPcs = new Map<number, Set<QtyUnit>>();
  for (const size of sizes) {
    for (const t of size.tiers) {
      const pcs = toPcs(t);
      byPcs.set(pcs, (byPcs.get(pcs) ?? new Set<QtyUnit>()).add(t.qtyUnit));
    }
  }
  return [...byPcs.entries()].sort(([a], [b]) => a - b).map(([pcs, units]) => {
    const rim = units.has("rim");
    const column: TierColumn = rim ? { minQty: pcs / PCS_PER_RIM, qtyUnit: "rim" } : { minQty: pcs, qtyUnit: "pcs" };
    return units.size > 1 ? { ...column, mixed: true } : column;
  });
}

/** The size's tier at this column's threshold, in whichever unit the size wrote it; or null (the table shows "—"). */
export function cellFor(size: Size, col: TierColumn): PriceTier | null {
  const pcs = toPcs(col);
  return size.tiers.find((t) => toPcs(t) === pcs) ?? null;
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
