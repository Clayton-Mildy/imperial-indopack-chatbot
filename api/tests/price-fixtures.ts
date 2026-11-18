/**
 * Price-tool fixture catalog, shared by the pure price-tool suite and the call-loop suite so both
 * assert against the same tiers. Not a *.test.ts, so vitest does not collect it as a suite.
 *
 * Tiers are the ones the plan's worked examples use: Kertas Supreme per rim without delivery
 * (5 rim Rp 185.000, 10 rim Rp 165.000, 20 rim Rp 160.000), the Ivory box per pcs with delivery
 * (5 rim Rp 2.000, 10 rim Rp 1.800, 20 rim Rp 1.500).
 */

import type { Brand, Product, ProductVariant } from '../src/domain/types.js';
import type { PriceTier, QtyUnit } from '../src/domain/pricing.js';

const TS = '2026-01-01T00:00:00.000Z';

const tier = (minQty: number, priceIdr: number, priceUnit: QtyUnit, includesDelivery: boolean): PriceTier => ({
  minQty, qtyUnit: 'rim', priceIdr, priceUnit, includesDelivery,
});

export const SUPREME_TIERS: PriceTier[] = [tier(5, 185_000, 'rim', false), tier(10, 165_000, 'rim', false), tier(20, 160_000, 'rim', false)];
export const IVORY_TIERS: PriceTier[] = [tier(5, 2000, 'pcs', true), tier(10, 1800, 'pcs', true), tier(20, 1500, 'pcs', true)];

const brand = (id: string, name: string): Brand => ({ id, name, description: null, catalogFileUrl: null, catalogFileName: null, catalogFileUploadedAt: null, brandType: 'own', createdAt: TS });

function variant(over: Partial<ProductVariant> & Pick<ProductVariant, 'id' | 'productId' | 'name'>): ProductVariant {
  return {
    sku: null, priceIdr: null, mpPriceIdr: null, isiCtn: null, isiBox: null,
    uomPriceId: null, mpUomId: null, uomCtnId: null, uomBoxId: null, minOrderQty: null, minOrderUomId: null,
    imageUrl: null, stockStatus: 'normal', isActive: true, description: null,
    sourceUrl: null, scrapedAt: null, sourceHash: null, createdAt: TS, updatedAt: TS,
    priceTiers: [],
    ...over,
  };
}

function product(id: string, name: string, b: Brand, variants: ProductVariant[]): Product {
  return {
    id, brandId: b.id, categoryId: null, name, description: null, fungsi: null, usp: null,
    kataKunci: null, kelengkapan: null, bahan: null, ketebalan: null, imageUrl: null,
    tier: null, relatedProductIds: null, upsellProductId: null, createdAt: TS, updatedAt: TS,
    brand: b, category: null, variants, referenceImageUrls: [],
  };
}

const KS = brand('b-ks', 'Kertas Supreme');
const II = brand('b-ii', 'Imperial Indopack');

export const SUPREME = product('p-ks1', 'Kertas Supreme 64 gsm cetak 1 warna', KS, [
  variant({ id: 'v-ks1-30', productId: 'p-ks1', name: '30 x 30 cm', priceTiers: SUPREME_TIERS }),
  // Listed in the block as out of stock, with no price - the tool must not quote it either.
  variant({ id: 'v-ks1-25', productId: 'p-ks1', name: '25 x 25 cm', stockStatus: 'no_stock', priceTiers: SUPREME_TIERS }),
  // Not in the block at all.
  variant({ id: 'v-ks1-40', productId: 'p-ks1', name: '40 x 40 cm', isActive: false, priceTiers: SUPREME_TIERS }),
  // "harga: dihitung tim" in the block.
  variant({ id: 'v-ks1-35', productId: 'p-ks1', name: '35 x 35 cm', priceTiers: [] }),
]);

// Shares "Kertas Supreme" and "cetak" with SUPREME, so a short name matches both.
export const SUPREME_2 = product('p-ks2', 'Kertas Supreme 64 gsm cetak 2 warna', KS, [
  variant({ id: 'v-ks2-30', productId: 'p-ks2', name: '30 x 30 cm', priceTiers: SUPREME_TIERS.map((t) => ({ ...t, priceIdr: t.priceIdr + 20_000 })) }),
]);

export const IVORY_BOX = product('p-ii1', 'Box Ivory 270 gsm cetak full color', II, [
  variant({ id: 'v-ii1-20', productId: 'p-ii1', name: '20x20x7,5', priceTiers: IVORY_TIERS }),
]);

export const CATALOG: Product[] = [SUPREME, SUPREME_2, IVORY_BOX];

export const SUPREME_INPUT = { product: 'kertas supreme 64 gsm cetak 1 warna', size: '30 x 30 cm', qty: 12, unit: 'rim' as const };
export const IVORY_INPUT = { product: 'Box Ivory 270 gsm cetak full color', size: '20x20x7,5', qty: 8, unit: 'rim' as const };

// 10 rim of the Ivory box: the 10-rim tier, Rp 1.800/pcs x 5.000 pcs.
export const BOX_UNIT = 1800;
export const BOX_TOTAL = 9_000_000;
