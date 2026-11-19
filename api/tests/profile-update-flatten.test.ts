import { describe, it, expect } from 'vitest';
import { extractFromToolInput, flattenProfileUpdate } from '../src/services/aiLayer.js';

describe('flattenProfileUpdate', () => {
  it('lifts nested customer and order objects to the top level', () => {
    expect(flattenProfileUpdate({
      customer: { name: 'Budi', business_name: 'RM Siang Contoh' },
      order: { brands: ['kertas_supreme'], items: [{ product: 'Kertas Supreme 64 gsm', size: '30 x 30 cm', has_design: false }] },
    })).toEqual({
      name: 'Budi', business_name: 'RM Siang Contoh',
      brands: ['kertas_supreme'], items: [{ product: 'Kertas Supreme 64 gsm', size: '30 x 30 cm', has_design: false }],
    });
  });
  it('keeps flat keys, and a flat key wins over a nested one', () => {
    expect(flattenProfileUpdate({ name: 'Budi', customer: { name: 'Lain', business_name: 'X' } })).toEqual({ name: 'Budi', business_name: 'X' });
  });
  it('is undefined for anything that is not an object', () => {
    expect(flattenProfileUpdate(undefined)).toBeUndefined();
    expect(flattenProfileUpdate([1])).toBeUndefined();
  });
  it('extractFromToolInput returns the flat profile update', () => {
    const r = extractFromToolInput({ message: 'ok', confidence: 'high', profile_update: { order: { items: [{ product: 'A', has_design: true }] } } });
    expect(r.profileUpdate).toEqual({ items: [{ product: 'A', has_design: true }] });
  });
});
