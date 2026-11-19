/**
 * nearest-catalog.test.ts
 *
 * The conversation panel's "Terdekat di katalog": for an item the customer asked for, the active
 * catalog product sharing the most words with it, that product's variant with the closest
 * dimensions, and the price tier its quantity lands on. Pure.
 */

import { describe, it, expect } from 'vitest';
import { parseSizeDims, nearestCatalogItem } from '../src/services/nearestCatalog.js';
import type { Product, ProductVariant } from '../src/domain/types.js';
import type { PriceTier } from '../src/domain/pricing.js';

const TS = '2026-01-01T00:00:00.000Z';

/** A tier starting at `minQty` rim, priced per pcs with delivery (the box price list's shape). */
const T = (minQty: number, priceIdr: number): PriceTier => ({ minQty, qtyUnit: 'rim', priceIdr, priceUnit: 'pcs', includesDelivery: true });
/** Per rim, without delivery (the paper price list's shape). */
const R = (minQty: number, priceIdr: number): PriceTier => ({ minQty, qtyUnit: 'rim', priceIdr, priceUnit: 'rim', includesDelivery: false });

function variant(productId: string, name: string, tiers: PriceTier[], over: Partial<ProductVariant> = {}): ProductVariant {
  return {
    id: `${productId}-${name}`, productId, name, sku: null, priceIdr: null, mpPriceIdr: null, isiCtn: null, isiBox: null,
    uomPriceId: null, mpUomId: null, uomCtnId: null, uomBoxId: null, minOrderQty: null, minOrderUomId: null,
    imageUrl: null, stockStatus: 'normal', isActive: true, description: null,
    sourceUrl: null, scrapedAt: null, sourceHash: null, createdAt: TS, updatedAt: TS, priceTiers: tiers,
    ...over,
  };
}

function product(id: string, name: string, sizes: string[], tiers: PriceTier[], over: Partial<Product> = {}): Product {
  return {
    id, brandId: 'b', categoryId: null, name, description: null, fungsi: null, usp: null, kataKunci: null,
    kelengkapan: null, bahan: null, ketebalan: null, imageUrl: null, isActive: true, createdAt: TS, updatedAt: TS,
    variants: sizes.map((s) => variant(id, s, tiers)), referenceImageUrls: [],
    ...over,
  };
}

const BOX_IVORY = ({ sizes, tiers }: { sizes: string[]; tiers: PriceTier[] }) => product('p-ivory', 'Box Ivory 270 gsm cetak full color', sizes, tiers);
const BOXES = [BOX_IVORY({ sizes: ['21 x 7 x 5 cm', '21 x 14 x 5 cm'], tiers: [T(5, 1900), T(10, 1500)] })];
const SUPREME = product('p-ks', 'Kertas Supreme 64 gsm cetak 1 warna', ['30x30', '32x32'], [R(5, 185_000), R(10, 165_000)]);

describe('parseSizeDims', () => {
  it('parses dimensions', () => {
    expect(parseSizeDims('22×22×7')).toEqual([22, 22, 7]);
    expect(parseSizeDims('20 x 20 x 7,5 cm')).toEqual([20, 20, 7.5]);
    expect(parseSizeDims('besar')).toBeNull();
  });

  it('reads 30*30 and 30 X 30, and refuses a size with words in it', () => {
    expect(parseSizeDims('30*30')).toEqual([30, 30]);
    expect(parseSizeDims('30 X 30')).toEqual([30, 30]);
    expect(parseSizeDims('kira-kira 30x30')).toBeNull();
    expect(parseSizeDims('')).toBeNull();
  });
});

describe('nearestCatalogItem', () => {
  it('22x22x7 is nearest to 21 x 14 x 5 cm, not exact, at the 10-rim tier for 5000 pcs', () =>
    expect(nearestCatalogItem({ product: 'box ivory full color', size: '22x22x7', qty: 5000, qty_unit: 'pcs' }, BOXES))
      .toMatchObject({ variantName: '21 x 14 x 5 cm', exact: false, tier: { minQty: 10, priceIdr: 1500 } }));

  it('names the product and keeps the item it was asked for', () => {
    const item = { product: 'box ivory full color', size: '22x22x7', qty: 5000, qty_unit: 'pcs' as const };
    expect(nearestCatalogItem(item, BOXES)).toMatchObject({
      item, productId: 'p-ivory', productName: 'Box Ivory 270 gsm cetak full color',
      quote: { kind: 'quote', unitPriceIdr: 1500, totalIdr: 7_500_000 },
    });
  });

  it('30 x 30 cm matches 30x30 exactly', () =>
    expect(nearestCatalogItem({ product: 'kertas supreme', size: '30 x 30 cm', qty: 10, qty_unit: 'rim' }, [SUPREME, ...BOXES]))
      .toMatchObject({ productId: 'p-ks', variantName: '30x30', exact: true, tier: { minQty: 10, priceIdr: 165_000 } }));

  it('a two-dimension size never matches a box', () =>
    expect(nearestCatalogItem({ product: 'box ivory', size: '30x30', qty: 5000, qty_unit: 'pcs' }, BOXES)).toBeNull());

  it('no shared word gives null', () =>
    expect(nearestCatalogItem({ product: 'plastik klip', size: '21 x 14 x 5' }, BOXES)).toBeNull());

  it('no size, or a size with no numbers, gives null', () => {
    expect(nearestCatalogItem({ product: 'box ivory', qty: 5000, qty_unit: 'pcs' }, BOXES)).toBeNull();
    expect(nearestCatalogItem({ product: 'box ivory', size: 'besar' }, BOXES)).toBeNull();
  });

  it('the most shared words win; a tie goes to the name that sorts first', () => {
    const kraft = product('p-kraft', 'Box Kraft cetak 1 warna', ['21 x 14 x 5 cm'], [T(5, 1200)]);
    const coklat = product('p-coklat', 'Box Coklat cetak 1 warna', ['21 x 14 x 5 cm'], [T(5, 1300)]);
    // 'box kraft' shares two words with Box Kraft, one with the others.
    expect(nearestCatalogItem({ product: 'box kraft', size: '21x14x5' }, [...BOXES, coklat, kraft])?.productId).toBe('p-kraft');
    // 'box' alone: one word each, so the first name alphabetically (Box Coklat < Box Ivory < Box Kraft).
    expect(nearestCatalogItem({ product: 'box', size: '21x14x5' }, [kraft, ...BOXES, coklat])?.productId).toBe('p-coklat');
  });

  it('one-letter words do not count', () =>
    expect(nearestCatalogItem({ product: 'x', size: '21x14x5' }, BOXES)).toBeNull());

  it('skips a product switched off and a variant switched off', () => {
    const off = product('p-off', 'Box Ivory 270 gsm cetak full color premium', ['22 x 22 x 7 cm'], [T(5, 900)], { isActive: false });
    const withOffVariant = BOX_IVORY({ sizes: ['21 x 7 x 5 cm'], tiers: [T(5, 1900)] });
    withOffVariant.variants!.push(variant('p-ivory', '22 x 22 x 7 cm', [T(5, 900)], { isActive: false }));
    expect(nearestCatalogItem({ product: 'box ivory premium', size: '22x22x7' }, [off, withOffVariant]))
      .toMatchObject({ productId: 'p-ivory', variantName: '21 x 7 x 5 cm', exact: false });
  });

  it('with no quantity there is no quote, and the tier is the lowest one', () =>
    expect(nearestCatalogItem({ product: 'box ivory', size: '21 x 14 x 5 cm' }, BOXES))
      .toMatchObject({ exact: true, quote: null, tier: { minQty: 5, priceIdr: 1900 } }));

  it('below the minimum: the quote says so and the tier is the lowest one', () =>
    expect(nearestCatalogItem({ product: 'box ivory', size: '21x14x5', qty: 1000, qty_unit: 'pcs' }, BOXES))
      .toMatchObject({ quote: { kind: 'below_minimum' }, tier: { minQty: 5, priceIdr: 1900 } }));

  // quotePrice prices nothing past the top tier (the team does); the tier shown is then the lowest.
  it('above the top tier: the quote says so and the tier is the lowest one', () =>
    expect(nearestCatalogItem({ product: 'kertas supreme', size: '30x30', qty: 12, qty_unit: 'rim' }, [SUPREME]))
      .toMatchObject({ quote: { kind: 'above_top_tier', top: { minQty: 10 } }, tier: { minQty: 5, priceIdr: 185_000 } }));

  it('a variant with no tiers has no tier', () => {
    const unpriced = product('p-ivory', 'Box Ivory 270 gsm cetak full color', ['21 x 14 x 5 cm'], []);
    expect(nearestCatalogItem({ product: 'box ivory', size: '21x14x5', qty: 5000, qty_unit: 'pcs' }, [unpriced]))
      .toMatchObject({ quote: { kind: 'no_tiers' }, tier: null });
  });
});
