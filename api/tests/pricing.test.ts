import { describe, expect, it } from 'vitest';
import { quotePrice, toPcs, type PriceTier } from '../src/domain/pricing.js';

const t = (minQty: number, priceIdr: number, priceUnit: 'rim' | 'pcs', includesDelivery: boolean): PriceTier => ({
  minQty,
  qtyUnit: 'rim',
  priceIdr,
  priceUnit,
  includesDelivery,
});
const IVORY: PriceTier[] = [t(5, 2000, 'pcs', true), t(10, 1800, 'pcs', true), t(20, 1500, 'pcs', true)];
const BURGER: PriceTier[] = [t(5, 185_000, 'rim', false), t(10, 165_000, 'rim', false), t(20, 160_000, 'rim', false)];

describe('quotePrice', () => {
  it('8 rim between tiers gets the 5-rim price and names the 10-rim tier', () => {
    const q = quotePrice(IVORY, 8, 'rim');
    expect(q).toMatchObject({ kind: 'quote', unitPriceIdr: 2000, totalIdr: 8_000_000, qtyInPriceUnit: 4000 });
    expect(q.kind === 'quote' && q.nextTier?.minQty).toBe(10);
  });
  it('exactly the top tier is quoted with no next tier', () =>
    expect(quotePrice(IVORY, 20, 'rim')).toMatchObject({ kind: 'quote', unitPriceIdr: 1500, totalIdr: 15_000_000, nextTier: null }));
  it('above the top tier goes to staff', () => expect(quotePrice(IVORY, 21, 'rim').kind).toBe('above_top_tier'));
  it('below the lowest tier', () => expect(quotePrice(IVORY, 4, 'rim')).toMatchObject({ kind: 'below_minimum', minimum: { minQty: 5 } }));
  it('pcs against rim tiers', () => expect(quotePrice(IVORY, 3000, 'pcs')).toMatchObject({ kind: 'quote', totalIdr: 6_000_000 }));
  it('per-rim price, between tiers', () => expect(quotePrice(BURGER, 12, 'rim')).toMatchObject({ unitPriceIdr: 165_000, totalIdr: 1_980_000 }));
  it('fractional rim from pcs', () => expect(quotePrice(BURGER, 2700, 'pcs')).toMatchObject({ qtyInPriceUnit: 5.4, totalIdr: 999_000 }));
  it('no tiers', () => expect(quotePrice([], 10, 'rim').kind).toBe('no_tiers'));
  it('a misread "2.500 pcs" as 2.5 never quotes', () => expect(quotePrice(IVORY, 2.5, 'pcs').kind).toBe('below_minimum'));
  it('rejects zero, negative and NaN quantities as below_minimum', () =>
    [0, -5, Number.NaN].forEach((n) => expect(quotePrice(IVORY, n, 'rim').kind).toBe('below_minimum')));
  it('does not mutate the caller tiers and sorts mixed units', () => {
    const tiers = [t(20, 1500, 'pcs', true), { ...t(0, 2000, 'pcs', true), minQty: 2500, qtyUnit: 'pcs' as const }];
    const copy = JSON.parse(JSON.stringify(tiers));
    expect(quotePrice(tiers, 3000, 'pcs')).toMatchObject({ kind: 'quote', unitPriceIdr: 2000 });
    expect(tiers).toEqual(copy);
    expect(toPcs(2, 'rim')).toBe(1000);
  });
});
