/**
 * product-spec.test.ts - the "Gramasi: · Cetak: · Finishing:" line a product's description holds
 * (domain/productSpec.ts), shared by the Excel template and the product editor. Pure.
 */
import { describe, it, expect } from 'vitest';
import { formatProductSpec, parseProductSpec } from '../src/domain/productSpec.js';

describe('productSpec', () => {
  it('spec round-trips', () => expect(parseProductSpec(formatProductSpec({ gsm: '64 gsm', print: '1 warna', finishing: null }))).toEqual({ gsm: '64 gsm', print: '1 warna', finishing: null }));

  it('formats all three in order, and null when all are empty', () => {
    expect(formatProductSpec({ gsm: '64 gsm', print: '1 warna', finishing: 'Laminasi food grade' }))
      .toBe('Gramasi: 64 gsm · Cetak: 1 warna · Finishing: Laminasi food grade');
    expect(formatProductSpec({ gsm: null, print: null, finishing: 'laminasi' })).toBe('Finishing: laminasi');
    expect(formatProductSpec({ gsm: null, print: '  ', finishing: '' })).toBeNull();
  });

  it('reads unlabelled text as no spec, and drops unknown parts', () => {
    expect(parseProductSpec('Teks bebas tim')).toEqual({ gsm: null, print: null, finishing: null });
    expect(parseProductSpec(null)).toEqual({ gsm: null, print: null, finishing: null });
    expect(parseProductSpec('Gramasi: 270 gsm · Warna: putih · Finishing: Non laminasi'))
      .toEqual({ gsm: '270 gsm', print: null, finishing: 'Non laminasi' });
  });
});
