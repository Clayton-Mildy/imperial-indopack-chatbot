import { describe, it, expect } from 'vitest';
import { normalizeGsm, sameGsm, compareGsm, formatGsmList, gramasiOfSize } from '../src/domain/gramasi.js';
import { IVORY_BOX } from './price-fixtures.js';
import type { Product, ProductVariant } from '../src/domain/types.js';

const row = (over: Partial<ProductVariant>): ProductVariant => ({
  ...IVORY_BOX.variants![0]!,
  ...over,
});

describe('normalizeGsm', () => {
  it('reads numeric forms as "<n> gsm"', () => {
    for (const raw of ['300', 300, '300gsm', ' 300 GSM ']) expect(normalizeGsm(raw)).toBe('300 gsm');
  });
  it('maps empty to null and keeps other text', () => {
    expect(normalizeGsm('')).toBeNull();
    expect(normalizeGsm('   ')).toBeNull();
    expect(normalizeGsm(null)).toBeNull();
    expect(normalizeGsm(undefined)).toBeNull();
    expect(normalizeGsm('Tebal')).toBe('Tebal');
    expect(normalizeGsm('  Art   paper ')).toBe('Art paper');
  });
});

describe('sameGsm', () => {
  it('compares normalised values', () => {
    expect(sameGsm('300', '300 gsm')).toBe(true);
    expect(sameGsm(null, null)).toBe(true);
    expect(sameGsm(null, '')).toBe(true);
    expect(sameGsm('270 gsm', '300 gsm')).toBe(false);
    expect(sameGsm(null, '300 gsm')).toBe(false);
  });
});

describe('compareGsm', () => {
  it('puts null first, numbers ascending, then text alphabetical', () => {
    expect(['350 gsm', null, 'art', '270 gsm'].sort(compareGsm)).toEqual([null, '270 gsm', '350 gsm', 'art']);
    expect(['b', '100 gsm', 'a', null].sort(compareGsm)).toEqual([null, '100 gsm', 'a', 'b']);
  });
});

describe('formatGsmList', () => {
  it('joins with commas and atau', () => {
    expect(formatGsmList(['270 gsm', '300 gsm', '350 gsm'])).toBe('270, 300 atau 350 gsm');
    expect(formatGsmList(['270 gsm', '300 gsm'])).toBe('270 atau 300 gsm');
    expect(formatGsmList(['300 gsm'])).toBe('300 gsm');
  });
});

describe('gramasiOfSize', () => {
  const product: Product = {
    ...IVORY_BOX,
    variants: [
      row({ id: 'a', name: '20x20x7', gsm: '300 gsm' }),
      row({ id: 'b', name: '20 x 20 x 7', gsm: '270 gsm' }),
      row({ id: 'c', name: '20x20x7', gsm: '350 gsm', isActive: false }),
      row({ id: 'd', name: '20x20x7', gsm: null }),
      row({ id: 'e', name: '30x30', gsm: '250 gsm' }),
    ],
  };
  it('lists the distinct gsm of active rows of that size, sorted', () => {
    expect(gramasiOfSize(product, '20x20x7')).toEqual(['270 gsm', '300 gsm']);
  });
  it('returns [] for an absent size', () => {
    expect(gramasiOfSize(product, '99x99')).toEqual([]);
  });
});
