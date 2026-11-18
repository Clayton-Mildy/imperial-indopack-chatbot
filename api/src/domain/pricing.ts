export type QtyUnit = 'rim' | 'pcs';
export const PCS_PER_RIM = 500;
export const FALLBACK_MIN_PCS = 2500;

export interface PriceTier {
  minQty: number;
  qtyUnit: QtyUnit;
  priceIdr: number;
  priceUnit: QtyUnit;
  includesDelivery: boolean;
  note?: string | null;
}

export type PriceQuote =
  | {
      kind: 'quote';
      tier: PriceTier;
      qtyInPriceUnit: number;
      unitPriceIdr: number;
      totalIdr: number;
      includesDelivery: boolean;
      nextTier: PriceTier | null;
    }
  | { kind: 'below_minimum'; minimum: PriceTier }
  | { kind: 'above_top_tier'; top: PriceTier }
  | { kind: 'no_tiers' };

export function toPcs(qty: number, unit: QtyUnit): number {
  return unit === 'rim' ? qty * PCS_PER_RIM : qty;
}

const tierPcs = (t: PriceTier): number => toPcs(t.minQty, t.qtyUnit);

export function quotePrice(tiers: PriceTier[], qty: number, unit: QtyUnit): PriceQuote {
  if (tiers.length === 0) return { kind: 'no_tiers' };
  const sorted = [...tiers].sort((a, b) => tierPcs(a) - tierPcs(b));
  const lowest = sorted[0]!;
  const top = sorted[sorted.length - 1]!;
  const pcs = toPcs(qty, unit);

  if (!Number.isFinite(pcs) || pcs <= 0 || pcs < tierPcs(lowest)) {
    return { kind: 'below_minimum', minimum: lowest };
  }
  if (pcs > tierPcs(top)) return { kind: 'above_top_tier', top };

  let idx = 0;
  for (let i = 0; i < sorted.length; i++) if (tierPcs(sorted[i]!) <= pcs) idx = i;
  const tier = sorted[idx]!;
  const qtyInPriceUnit = pcs / (tier.priceUnit === 'rim' ? PCS_PER_RIM : 1);
  return {
    kind: 'quote',
    tier,
    qtyInPriceUnit,
    unitPriceIdr: tier.priceIdr,
    totalIdr: Math.round(qtyInPriceUnit * tier.priceIdr),
    includesDelivery: tier.includesDelivery,
    nextTier: sorted[idx + 1] ?? null,
  };
}
