/**
 * Shared catalog fixtures for the export and import suites.
 *
 * They live in one file so the round-trip test asserts against the SAME rows the export test
 * asserts on: a fixture that drifts between the two would let the pair pass while the real
 * export/import pair lost a column. Not a *.test.ts, so vitest does not collect it as a suite.
 */

import type { Brand, Category, Product, ProductVariant, Uom } from '../src/domain/types.js';

export const uomSet: Uom = { id: 'u1', name: 'Set', description: null, createdAt: '' };
export const uomPcs: Uom = { id: 'u2', name: 'Pcs', description: 'Piece', createdAt: '' };

export const brand: Brand = {
  id: 'b1',
  name: 'Vintage',
  description: 'Lini premium',
  catalogFileUrl: null,
  brandType: 'own',
  createdAt: '',
};

export const category: Category = { id: 'c1', name: 'Kunci', description: null, createdAt: '' };

export function variant(over: Partial<ProductVariant>): ProductVariant {
  return {
    id: 'v1',
    productId: 'p1',
    name: 'GOTHIC (BLACK)',
    sku: null,
    priceIdr: 116000,
    // Per Pcs while the pricelist figure is per Set - the two UOMs differ on purpose, and the
    // round-trip test asserts that survives.
    mpPriceIdr: 13500,
    isiCtn: 30,
    isiBox: 1,
    uomPriceId: 'u1',
    mpUomId: 'u2',
    uomCtnId: 'u1',
    uomBoxId: 'u1',
    minOrderQty: 3,
    minOrderUomId: 'u1',
    uomPrice: uomSet,
    mpUom: uomPcs,
    uomCtn: uomSet,
    uomBox: uomSet,
    uomMinOrder: uomSet,
    imageUrl: null,
    stockStatus: 'normal',
    isActive: true,
    description: null,
    sourceUrl: null,
    scrapedAt: null,
    sourceHash: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

// p1 has two variants and points at p2 for upsell + related; p2 has none.
export const p1: Product = {
  id: 'p1',
  brandId: 'b1',
  categoryId: 'c1',
  name: 'BODY BIASA 8545-NL',
  description: null,
  fungsi: 'mekanisme utama pintu',
  usp: null,
  kataKunci: 'rumah kunci',
  kelengkapan: 'Body, Skrup',
  bahan: 'Plat Stainless Steel',
  ketebalan: '2mm',
  imageUrl: null,
  tier: 'mid',
  relatedProductIds: ['p2'],
  upsellProductId: 'p2',
  createdAt: '',
  updatedAt: '',
  brand,
  category,
  variants: [
    variant({}),
    variant({ id: 'v2', name: 'SN (SILVER)', isActive: false, priceIdr: null, mpPriceIdr: null, mpUomId: null }),
  ],
};

export const p2: Product = {
  ...p1,
  id: 'p2',
  name: 'ENGSEL 4 INCH',
  categoryId: null,
  category: null,
  tier: null,
  relatedProductIds: null,
  upsellProductId: null,
  variants: [],
};
