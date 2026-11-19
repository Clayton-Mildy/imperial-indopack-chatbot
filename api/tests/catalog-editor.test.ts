/**
 * catalog-editor.test.ts - the product editor's pure half (services/catalogEditor.ts): the draft
 * schema, validateProductDraft and diffProduct. No database.
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_TEXT_LENGTH,
  MAX_TIER_PRICE_IDR,
  MAX_TIER_QTY,
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
const S = (size: string, tiers: DraftTier[], id?: string, gsm: string | null = null): DraftSize => ({ size, gsm, tiers, ...(id ? { id } : {}) });
const DRAFT = (over: Partial<ProductDraft> = {}): ProductDraft => ({
  brand: 'kertas_supreme',
  name: 'Kertas Contoh 64 gsm',
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
  print: 'Full color',
  finishing: 'Non laminasi',
  use: 'box kue, cookies, snack',
  isActive: true,
  sizes: [{ id: 'v-21-14-5', size: '21 x 14 x 5 cm', gsm: null, tiers: [tier(5, 'rim', 1900, 'pcs'), tier(10, 'rim', 1500, 'pcs')] }],
};
const EDIT_10RIM_1450 = { id: 'v-21-14-5', size: '21 x 14 x 5 cm', gsm: null, tiers: [tier(5, 'rim', 1900, 'pcs'), tier(10, 'rim', 1450, 'pcs')] };
const NEW_SIZE = { size: '25 x 8 x 6 cm', gsm: null, tiers: [tier(5, 'rim', 2100, 'pcs')] };

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

  it('a fractional, zero, negative or out-of-range number is invalid, not missing, by index', () => {
    const bad = [T(2.5), T(0), T(-5), T(3_000_000_000), T(MAX_TIER_QTY + 1), T(5, 1500.5), T(6, 0), T(7, -1000), T(8, MAX_TIER_PRICE_IDR + 1)];
    expect(validateProductDraft(DRAFT({ sizes: [S('30x30', bad)] }))).toEqual({
      ok: false,
      errors: [
        { code: 'qty_invalid', sizeIndex: 0, tierIndex: 0 },
        { code: 'qty_invalid', sizeIndex: 0, tierIndex: 1 },
        { code: 'qty_invalid', sizeIndex: 0, tierIndex: 2 },
        { code: 'qty_invalid', sizeIndex: 0, tierIndex: 3 },
        { code: 'qty_invalid', sizeIndex: 0, tierIndex: 4 },
        { code: 'price_invalid', sizeIndex: 0, tierIndex: 5 },
        { code: 'price_invalid', sizeIndex: 0, tierIndex: 6 },
        { code: 'price_invalid', sizeIndex: 0, tierIndex: 7 },
        { code: 'price_invalid', sizeIndex: 0, tierIndex: 8 },
      ],
    });
  });

  it('accepts the caps themselves', () => {
    const r = validateProductDraft(DRAFT({ sizes: [S('30x30', [T(MAX_TIER_QTY, MAX_TIER_PRICE_IDR)])] }));
    expect(r.ok).toBe(true);
  });

  it('trims names and sizes, empties a blank spec field, and returns PriceTiers', () => {
    const r = validateProductDraft(DRAFT({ name: '  Kertas Contoh  ', print: ' 1 warna ', sizes: [S(' 30 x 30 cm ', [T(5, 185000), T(10, 165000)], 'id-1')] }));
    expect(r).toEqual({
      ok: true,
      input: {
        brand: 'kertas_supreme', name: 'Kertas Contoh', print: '1 warna', finishing: null, use: 'bungkus nasi', isActive: true,
        sizes: [{ id: 'id-1', size: '30 x 30 cm', gsm: null, tiers: [
          { minQty: 5, qtyUnit: 'rim', priceIdr: 185000, priceUnit: 'rim', includesDelivery: false },
          { minQty: 10, qtyUnit: 'rim', priceIdr: 165000, priceUnit: 'rim', includesDelivery: false },
        ] }],
      },
    });
  });
});

describe('gramasi on size rows', () => {
  it('the same size under two gramasi is allowed', () => {
    const r = validateProductDraft(DRAFT({ sizes: [S('30x30', [T(5)], undefined, '270'), S('30x30', [T(5)], undefined, '300 gsm')] }));
    expect(r.ok).toBe(true);
    expect(r.ok && r.input.sizes.map((s) => s.gsm)).toEqual(['270 gsm', '300 gsm']);
  });

  it("the same size twice under one gramasi is duplicate_size: '300' and '300 gsm' are one gramasi", () => {
    const r = validateProductDraft(DRAFT({ sizes: [S('30x30', [T(5)], undefined, '300'), S('30 x 30 cm', [T(5)], undefined, '300 gsm')] }));
    expect(r).toEqual({ ok: false, errors: [{ code: 'duplicate_size', sizeIndex: 1 }] });
  });

  it('some sizes with gramasi and some without is gsm_mixed at the first breaking index', () => {
    const r = validateProductDraft(DRAFT({ sizes: [S('30x30', [T(5)], undefined, '270'), S('35x35', [T(5)]), S('40x40', [T(5)], undefined, '300')] }));
    expect(r).toEqual({ ok: false, errors: [{ code: 'gsm_mixed', sizeIndex: 1 }] });
    const r2 = validateProductDraft(DRAFT({ sizes: [S('30x30', [T(5)]), S('35x35', [T(5)], undefined, '300')] }));
    expect(r2).toEqual({ ok: false, errors: [{ code: 'gsm_mixed', sizeIndex: 1 }] });
  });

  it('a blank gramasi is no gramasi', () => {
    const r = validateProductDraft(DRAFT({ sizes: [S('30x30', [T(5)], undefined, '  ')] }));
    expect(r.ok && r.input.sizes[0]!.gsm).toBeNull();
  });
});

describe('ProductDraftSchema', () => {
  const body = (t: Record<string, unknown>) => ({ ...DRAFT(), sizes: [{ size: '30x30', gsm: null, tiers: [{ ...T(5), ...t }] }] });

  it('accepts a draft with nulls where the form is still empty', () => {
    expect(ProductDraftSchema.safeParse(body({})).success).toBe(true);
    expect(ProductDraftSchema.safeParse(body({ minQty: null, priceIdr: null })).success).toBe(true);
  });

  it('lets any finite number through, so validateProductDraft can name the bad field', () => {
    for (const t of [{ priceIdr: 1500.5 }, { priceIdr: 0 }, { priceIdr: -1000 }, { minQty: 2.5 }, { minQty: 3_000_000_000 }]) {
      expect(ProductDraftSchema.safeParse(body(t)).success, JSON.stringify(t)).toBe(true);
    }
  });

  it('refuses a non-number, an unknown unit, and an over-long text', () => {
    const long = 'x'.repeat(MAX_TEXT_LENGTH + 1);
    for (const t of [{ priceIdr: '1500' }, { minQty: Number.POSITIVE_INFINITY }, { qtyUnit: 'box' }]) {
      expect(ProductDraftSchema.safeParse(body(t)).success, JSON.stringify(t)).toBe(false);
    }
    for (const over of [{ name: long }, { print: long }, { finishing: long }, { use: 'x'.repeat(501) }]) {
      expect(ProductDraftSchema.safeParse({ ...DRAFT(), ...over }).success, Object.keys(over)[0]).toBe(false);
    }
    expect(ProductDraftSchema.safeParse({ ...DRAFT(), sizes: [S(long, [T(5)])] }).success).toBe(false);
    expect(ProductDraftSchema.safeParse({ ...DRAFT(), sizes: [S('30x30', [T(5)], undefined, long)] }).success).toBe(false);
    expect(ProductDraftSchema.safeParse({ ...DRAFT(), name: 'x'.repeat(MAX_TEXT_LENGTH) }).success).toBe(true);
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
    const after: ProductInput = { ...BOX, name: 'Box Ivory 300 gsm', brand: 'kertas_supreme', use: 'box kue, bento kecil', isActive: false };
    expect(diffProduct(BOX, after)).toEqual([
      { kind: 'field', field: 'name', from: 'Box Ivory 270 gsm cetak full color', to: 'Box Ivory 300 gsm' },
      { kind: 'field', field: 'brand', from: 'imperial_indopack', to: 'kertas_supreme' },
      { kind: 'field', field: 'use', from: 'box kue, cookies, snack', to: 'box kue, bento kecil' },
      { kind: 'active', to: false },
    ]);
  });

  it('sizes removed, added and renamed, then each kept size\'s tiers', () => {
    const before: ProductInput = {
      ...BOX,
      sizes: [
        { id: 'a', size: '21 x 7 x 5 cm', gsm: null, tiers: [tier(5, 'rim', 1500, 'pcs')] },
        { id: 'b', size: '21 x 14 x 5 cm', gsm: null, tiers: [tier(5, 'rim', 1900, 'pcs'), tier(10, 'rim', 1500, 'pcs')] },
      ],
    };
    const after: ProductInput = {
      ...BOX,
      sizes: [
        { id: 'b', size: '21 × 14 × 5 cm', gsm: null, tiers: [tier(5, 'rim', 1900, 'pcs', false), tier(20, 'rim', 1400, 'pcs')] },
        { size: '25 x 8 x 6 cm', gsm: null, tiers: [tier(5, 'rim', 2100, 'pcs')] },
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
    const before: ProductInput = { ...BOX, sizes: [{ id: 'v1', size: '30x30', gsm: null, tiers: [tier(5, 'rim', 185000, 'rim')] }] };
    const after: ProductInput = { ...BOX, sizes: [{ size: '30 x 30 cm', gsm: null, tiers: [tier(5, 'rim', 185000, 'rim')] }] };
    expect(diffProduct(before, after)).toEqual([{ kind: 'size_renamed', from: '30x30', to: '30 x 30 cm' }]);
  });

  it('nothing changed is an empty list', () => expect(diffProduct(BOX, structuredClone(BOX))).toEqual([]));

  describe('gramasi history', () => {
    const g = (id: string, size: string, gsm: string | null, minQty = 5, price = 1000) => ({ id, size, gsm, tiers: [tier(minQty, 'rim', price, 'pcs')] });
    const MULTI: ProductInput = { ...BOX, sizes: [g('a', '30x30', '270 gsm'), g('b', '35x35', '270 gsm'), g('c', '30x30', '300 gsm')] };

    it('renaming 270 to 280 on all its rows is one gsm_renamed', () => {
      const after: ProductInput = { ...MULTI, sizes: [g('a', '30x30', '280 gsm'), g('b', '35x35', '280 gsm'), g('c', '30x30', '300 gsm')] };
      expect(diffProduct(MULTI, after)).toEqual([{ kind: 'gsm_renamed', from: '270 gsm', to: '280 gsm' }]);
    });

    it('size and tier changes inside a renamed gramasi report under the new name', () => {
      const after: ProductInput = { ...MULTI, sizes: [g('a', '30x30', '280 gsm', 5, 900), g('b', '35x35', '280 gsm'), g('c', '30x30', '300 gsm')] };
      expect(diffProduct(MULTI, after)).toEqual([
        { kind: 'gsm_renamed', from: '270 gsm', to: '280 gsm' },
        { kind: 'tier_price', size: '30x30', gsm: '280 gsm', minQty: 5, qtyUnit: 'rim', priceUnit: 'pcs', from: 1000, to: 900 },
      ]);
    });

    it('a new gramasi with copied sizes is gsm_added plus size_added under it', () => {
      const after: ProductInput = { ...MULTI, sizes: [...MULTI.sizes, { size: '30x30', gsm: '350 gsm', tiers: [tier(5, 'rim', 1200, 'pcs')] }, { size: '35x35', gsm: '350 gsm', tiers: [tier(5, 'rim', 1200, 'pcs')] }] };
      expect(diffProduct(MULTI, after)).toEqual([
        { kind: 'gsm_added', gsm: '350 gsm' },
        { kind: 'size_added', size: '30x30', gsm: '350 gsm' },
        { kind: 'size_added', size: '35x35', gsm: '350 gsm' },
      ]);
    });

    it('removing a gramasi is gsm_removed', () => {
      const after: ProductInput = { ...MULTI, sizes: [g('a', '30x30', '270 gsm'), g('b', '35x35', '270 gsm')] };
      expect(diffProduct(MULTI, after)).toEqual([
        { kind: 'gsm_removed', gsm: '300 gsm' },
        { kind: 'size_removed', size: '30x30', gsm: '300 gsm' },
      ]);
    });

    it('moving one row from 270 to 300 is one row removed under 270 and added under 300, not a rename', () => {
      const after: ProductInput = { ...MULTI, sizes: [g('a', '30x30', '270 gsm'), g('b', '35x35', '300 gsm'), g('c', '30x30', '300 gsm')] };
      expect(diffProduct(MULTI, after)).toEqual([
        { kind: 'size_removed', size: '35x35', gsm: '270 gsm' },
        { kind: 'size_added', size: '35x35', gsm: '300 gsm' },
      ]);
    });

    it('a product gaining its first gramasi is gsm_added', () => {
      const before: ProductInput = { ...BOX, sizes: [g('a', '30x30', null)] };
      const after: ProductInput = { ...BOX, sizes: [g('a', '30x30', '270 gsm')] };
      expect(diffProduct(before, after)).toEqual([{ kind: 'gsm_added', gsm: '270 gsm' }]);
    });
  });
});
