/**
 * catalog-editor.test.ts - the product editor's pure half (services/catalogEditor.ts): the draft
 * schema, validateProductDraft and diffProduct. No database.
 */
import { describe, it, expect } from 'vitest';
import {
  ProductDraftSchema,
  validateProductDraft,
  diffProduct,
  type ProductDraft,
  type ProductInput,
} from '../src/services/catalogEditor.js';
import type { PriceTier, QtyUnit } from '../src/domain/pricing.js';

type DraftTier = ProductDraft['sizes'][number]['tiers'][number];
type DraftSize = ProductDraft['sizes'][number];

const T = (minQty: number | null, priceIdr: number | null = 100000, qtyUnit: QtyUnit = 'rim', priceUnit: QtyUnit = 'rim'): DraftTier =>
  ({ minQty, qtyUnit, priceIdr, priceUnit, includesDelivery: false });
const S = (size: string, tiers: DraftTier[], id?: string): DraftSize => ({ size, tiers, ...(id ? { id } : {}) });
const DRAFT = (over: Partial<ProductDraft> = {}): ProductDraft => ({
  brand: 'kertas_supreme',
  name: 'Kertas Contoh 64 gsm',
  gsm: '64 gsm',
  print: null,
  finishing: null,
  use: 'bungkus nasi',
  isActive: true,
  sizes: [S('30x30', [T(5)])],
  ...over,
});

const tier = (minQty: number, qtyUnit: QtyUnit, priceIdr: number, priceUnit: QtyUnit, includesDelivery = true): PriceTier =>
  ({ minQty, qtyUnit, priceIdr, priceUnit, includesDelivery });

const BOX: ProductInput = {
  brand: 'imperial_indopack',
  name: 'Box Ivory 270 gsm cetak full color',
  gsm: '270 gsm',
  print: 'Full color',
  finishing: 'Non laminasi',
  use: 'box kue, cookies, snack',
  isActive: true,
  sizes: [{ id: 'v-21-14-5', size: '21 x 14 x 5 cm', tiers: [tier(5, 'rim', 1900, 'pcs'), tier(10, 'rim', 1500, 'pcs')] }],
};
const EDIT_10RIM_1450 = { id: 'v-21-14-5', size: '21 x 14 x 5 cm', tiers: [tier(5, 'rim', 1900, 'pcs'), tier(10, 'rim', 1450, 'pcs')] };
const NEW_SIZE = { size: '25 x 8 x 6 cm', tiers: [tier(5, 'rim', 2100, 'pcs')] };

describe('validateProductDraft', () => {
  it('flags tier order, duplicate size and a missing price by index', () => {
    const r = validateProductDraft(DRAFT({ sizes: [S('30x30', [T(10), T(5)]), S('30 x 30 cm', [T(5, null)])] }));
    expect(r.ok === false && r.errors).toEqual(expect.arrayContaining([
      { code: 'tier_order', sizeIndex: 0, tierIndex: 1 }, { code: 'duplicate_size', sizeIndex: 1 }, { code: 'price_missing', sizeIndex: 1, tierIndex: 0 }]));
  });

  it('5 rim next to 2500 pcs is one threshold: tier_order, never a 500 from replaceVariantTiers', () => {
    const r = validateProductDraft(DRAFT({ sizes: [S('30x30', [T(5, 185000), T(2500, 370, 'pcs', 'pcs')])] }));
    expect(r).toEqual({ ok: false, errors: [{ code: 'tier_order', sizeIndex: 0, tierIndex: 1 }] });
  });

  it('the same tier twice is duplicate_tier, not also tier_order', () => {
    const r = validateProductDraft(DRAFT({ sizes: [S('30x30', [T(5), T(10), T(5, 90000)])] }));
    expect(r).toEqual({ ok: false, errors: [{ code: 'duplicate_tier', sizeIndex: 0, tierIndex: 2 }] });
  });

  it('reports tier_order once, on the first offending tier', () => {
    const r = validateProductDraft(DRAFT({ sizes: [S('30x30', [T(10), T(5), T(3)])] }));
    expect(r).toEqual({ ok: false, errors: [{ code: 'tier_order', sizeIndex: 0, tierIndex: 1 }] });
  });

  it('requires a name, a use, sizes, size text, tiers and a quantity', () => {
    expect(validateProductDraft(DRAFT({ name: '   ', use: ' ' }))).toEqual({ ok: false, errors: [{ code: 'name_required' }, { code: 'use_required' }] });
    expect(validateProductDraft(DRAFT({ sizes: [] }))).toEqual({ ok: false, errors: [{ code: 'no_sizes' }] });
    expect(validateProductDraft(DRAFT({ sizes: [S('  ', [T(5)]), S('35x35', []), S('40x40', [T(null)])] }))).toEqual({
      ok: false,
      errors: [{ code: 'size_required', sizeIndex: 0 }, { code: 'no_tiers', sizeIndex: 1 }, { code: 'qty_missing', sizeIndex: 2, tierIndex: 0 }],
    });
  });

  it('trims names and sizes, empties a blank spec field, and returns PriceTiers', () => {
    const r = validateProductDraft(DRAFT({ name: '  Kertas Contoh  ', gsm: '  ', print: ' 1 warna ', sizes: [S(' 30 x 30 cm ', [T(5, 185000), T(10, 165000)], 'id-1')] }));
    expect(r).toEqual({
      ok: true,
      input: {
        brand: 'kertas_supreme', name: 'Kertas Contoh', gsm: null, print: '1 warna', finishing: null, use: 'bungkus nasi', isActive: true,
        sizes: [{ id: 'id-1', size: '30 x 30 cm', tiers: [
          { minQty: 5, qtyUnit: 'rim', priceIdr: 185000, priceUnit: 'rim', includesDelivery: false },
          { minQty: 10, qtyUnit: 'rim', priceIdr: 165000, priceUnit: 'rim', includesDelivery: false },
        ] }],
      },
    });
  });
});

describe('ProductDraftSchema', () => {
  const body = (t: Record<string, unknown>) => ({ ...DRAFT(), sizes: [{ size: '30x30', tiers: [{ ...T(5), ...t }] }] });

  it('accepts a draft with nulls where the form is still empty', () => {
    expect(ProductDraftSchema.safeParse(body({})).success).toBe(true);
    expect(ProductDraftSchema.safeParse(body({ minQty: null, priceIdr: null })).success).toBe(true);
  });

  it('refuses a fractional or non-positive quantity or price (whole rupiah only)', () => {
    for (const t of [{ priceIdr: 1500.5 }, { priceIdr: 0 }, { priceIdr: -1000 }, { minQty: 2.5 }, { minQty: 0 }, { qtyUnit: 'box' }]) {
      expect(ProductDraftSchema.safeParse(body(t)).success, JSON.stringify(t)).toBe(false);
    }
  });

  it('refuses a brand that is not one of the two', () => {
    expect(ProductDraftSchema.safeParse({ ...DRAFT(), brand: 'other' }).success).toBe(false);
  });
});

describe('diffProduct', () => {
  it('diff lists a price change, an added size and a removed tier', () =>
    expect(diffProduct(BOX, { ...BOX, sizes: [EDIT_10RIM_1450, NEW_SIZE] })).toEqual([
      { kind: 'size_added', size: '25 x 8 x 6 cm' },
      { kind: 'tier_price', size: '21 x 14 x 5 cm', minQty: 10, qtyUnit: 'rim', priceUnit: 'pcs', from: 1500, to: 1450 }]));

  it('lists fields in order, then the active flag', () => {
    const after: ProductInput = { ...BOX, name: 'Box Ivory 300 gsm', brand: 'kertas_supreme', gsm: null, use: 'box kue, bento kecil', isActive: false };
    expect(diffProduct(BOX, after)).toEqual([
      { kind: 'field', field: 'name', from: 'Box Ivory 270 gsm cetak full color', to: 'Box Ivory 300 gsm' },
      { kind: 'field', field: 'brand', from: 'imperial_indopack', to: 'kertas_supreme' },
      { kind: 'field', field: 'gsm', from: '270 gsm', to: null },
      { kind: 'field', field: 'use', from: 'box kue, cookies, snack', to: 'box kue, bento kecil' },
      { kind: 'active', to: false },
    ]);
  });

  it('sizes removed, added and renamed, then each kept size\'s tiers', () => {
    const before: ProductInput = {
      ...BOX,
      sizes: [
        { id: 'a', size: '21 x 7 x 5 cm', tiers: [tier(5, 'rim', 1500, 'pcs')] },
        { id: 'b', size: '21 x 14 x 5 cm', tiers: [tier(5, 'rim', 1900, 'pcs'), tier(10, 'rim', 1500, 'pcs')] },
      ],
    };
    const after: ProductInput = {
      ...BOX,
      sizes: [
        { id: 'b', size: '21 × 14 × 5 cm', tiers: [tier(5, 'rim', 1900, 'pcs', false), tier(20, 'rim', 1400, 'pcs')] },
        { size: '25 x 8 x 6 cm', tiers: [tier(5, 'rim', 2100, 'pcs')] },
      ],
    };
    expect(diffProduct(before, after)).toEqual([
      { kind: 'size_removed', size: '21 x 7 x 5 cm' },
      { kind: 'size_added', size: '25 x 8 x 6 cm' },
      { kind: 'size_renamed', from: '21 x 14 x 5 cm', to: '21 × 14 × 5 cm' },
      { kind: 'tier_removed', size: '21 × 14 × 5 cm', minQty: 10, qtyUnit: 'rim' },
      { kind: 'delivery', size: '21 × 14 × 5 cm', minQty: 5, qtyUnit: 'rim', to: false },
      { kind: 'tier_added', size: '21 × 14 × 5 cm', minQty: 20, qtyUnit: 'rim' },
    ]);
  });

  it('a size sent without an id matches by normalizeSize, so retyping it is a rename', () => {
    const before: ProductInput = { ...BOX, sizes: [{ id: 'v1', size: '30x30', tiers: [tier(5, 'rim', 185000, 'rim')] }] };
    const after: ProductInput = { ...BOX, sizes: [{ size: '30 x 30 cm', tiers: [tier(5, 'rim', 185000, 'rim')] }] };
    expect(diffProduct(before, after)).toEqual([{ kind: 'size_renamed', from: '30x30', to: '30 x 30 cm' }]);
  });

  it('nothing changed is an empty list', () => expect(diffProduct(BOX, structuredClone(BOX))).toEqual([]));
});
