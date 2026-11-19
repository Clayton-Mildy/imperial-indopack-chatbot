/**
 * product-spec.test.ts - the "Cetak: · Finishing:" line a product's description holds
 * (domain/productSpec.ts), shared by the Excel template and the product editor. Pure.
 * Gramasi lives on the size rows; an old "Gramasi:" segment still reads cleanly (dropped).
 */
import { describe, it, expect } from 'vitest';
import { formatProductSpec, parseProductSpec } from '../src/domain/productSpec.js';

describe('productSpec', () => {
  it('spec round-trips', () => expect(parseProductSpec(formatProductSpec({ print: '1 warna', finishing: null }))).toEqual({ print: '1 warna', finishing: null }));

  it('formats cetak and finishing in order, and null when both are empty', () => {
    expect(formatProductSpec({ print: '1 warna', finishing: null })).toBe('Cetak: 1 warna');
    expect(formatProductSpec({ print: '1 warna', finishing: 'Laminasi food grade' })).toBe('Cetak: 1 warna · Finishing: Laminasi food grade');
    expect(formatProductSpec({ print: null, finishing: 'laminasi' })).toBe('Finishing: laminasi');
    expect(formatProductSpec({ print: '  ', finishing: '' })).toBeNull();
  });

  it('reads unlabelled text as no spec, and drops unknown parts and an old Gramasi segment', () => {
    expect(parseProductSpec('Teks bebas tim')).toEqual({ print: null, finishing: null });
    expect(parseProductSpec(null)).toEqual({ print: null, finishing: null });
    expect(parseProductSpec('Gramasi: 270 gsm · Cetak: 1 warna')).toEqual({ print: '1 warna', finishing: null });
    expect(parseProductSpec('Gramasi: 270 gsm · Warna: putih · Finishing: Non laminasi')).toEqual({ print: null, finishing: 'Non laminasi' });
  });
});
