/**
 * catalog-render-prices.test.ts
 * Which prices reach the AI's catalog block, for variants without tiers and out-of-stock ones.
 *
 * Prices are RENDERED from variant_price_tiers, never computed by the model: without hitung_harga,
 * verifyReplyTieredPrices() only accepts Rp figures that are literally in the block. The
 * no-tier case is the load-bearing one: "dihitung tim" and no digits is what makes the hand-off
 * to the team deterministic, because a figure invented for it is absent from the block.
 *
 * Pure - no DATABASE_URL, no API key.
 */

import { describe, it, expect } from 'vitest';
import { formatProducts } from '../src/services/ragQuery.js';
import { verifyReplyTieredPrices } from '../src/services/replyChecks.js';
import type { Product } from '../src/domain/types.js';
import type { PriceTier } from '../src/domain/pricing.js';

const TS = '2026-01-01T00:00:00.000Z';
const TIER: PriceTier = { minQty: 5, qtyUnit: 'rim', priceIdr: 2000, priceUnit: 'pcs', includesDelivery: true };

function productWith(priceTiers: PriceTier[]): Product {
  return {
    id: 'p1', brandId: 'b1', categoryId: null,
    name: 'Kertas Supreme 64 gsm cetak 1 warna', description: null, fungsi: 'bungkus nasi',
    usp: null, kataKunci: null, kelengkapan: null, bahan: null, ketebalan: null, imageUrl: null,
    tier: null, relatedProductIds: null, upsellProductId: null, createdAt: TS, updatedAt: TS,
    brand: { id: 'b1', name: 'Kertas Supreme', description: null, catalogFileUrl: null, catalogFileName: null, catalogFileUploadedAt: null, brandType: 'own', createdAt: TS },
    category: null,
    variants: [
      { id: 'v1', productId: 'p1', name: '30 x 30 cm', isActive: true, stockStatus: 'normal', priceTiers },
    ],
  } as unknown as Product;
}

describe('formatProducts - a variant without tiers carries no figure', () => {
  it('says the team prices it and renders no Rp figure', () => {
    const block = formatProducts([productWith([])]);
    expect(block).toContain('  • harga: dihitung tim');
    expect(block.match(/Rp [\d.]+/g)).toBeNull();
  });
});

// With a price on an out-of-stock line the model kept OFFERING it. What is not in the block cannot
// be quoted, and a figure made up for it fails verifyReplyTieredPrices.
describe('formatProducts - an out-of-stock variant carries no price', () => {
  function withOutOfStockSize(): Product {
    const p = productWith([TIER]);
    const [ready] = p.variants!;
    p.variants = [
      { ...ready!, id: 'v1', name: '25 x 25 cm' },
      { ...ready!, id: 'v2', name: '30 x 30 cm', stockStatus: 'no_stock', priceTiers: [{ ...TIER, priceIdr: 1234 }] },
    ];
    return p;
  }

  it('lists it by name with the tag and no figure', () => {
    const block = formatProducts([withOutOfStockSize()]);
    expect(block).toContain('  - Ukuran: 30 x 30 cm [STOK HABIS SEMENTARA]\n');
    expect(block).not.toContain('1.234');
    expect(block).toContain('Rp 2.000/pcs');
  });

  it('so an offer of its price fails the price check as not in the catalog', () => {
    const block = formatProducts([withOutOfStockSize()]);
    expect(verifyReplyTieredPrices('• 25 x 25 cm: Rp 1.234/pcs', block, undefined).ok).toBe(false);
    expect(verifyReplyTieredPrices('• 25 x 25 cm: Rp 2.000/pcs', block, undefined).ok).toBe(true);
  });
});
