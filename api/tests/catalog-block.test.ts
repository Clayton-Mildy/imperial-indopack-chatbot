import { describe, it, expect } from 'vitest';
import { detectBrand, formatProducts, formatTierLine, REFERENCE_PHOTOS_MARKER } from '../src/services/ragQuery.js';
import type { Product } from '../src/domain/types.js';

const TS = '2026-01-01T00:00:00.000Z';

function product(over: Partial<Product>, variants: unknown[]): Product {
  return {
    id: 'p1', brandId: 'b1', categoryId: null,
    name: 'Kertas Supreme 64 gsm cetak 1 warna', description: null,
    fungsi: 'bungkus nasi, kebab, burger', usp: null, kataKunci: null, kelengkapan: null,
    bahan: null, ketebalan: null, imageUrl: null, tier: null, relatedProductIds: null,
    upsellProductId: null, createdAt: TS, updatedAt: TS,
    brand: { id: 'b1', name: 'Kertas Supreme', description: null, catalogFileUrl: null, catalogFileName: null, catalogFileUploadedAt: null, brandType: 'own', createdAt: TS },
    category: null,
    variants: variants as Product['variants'],
    ...over,
  };
}

const tier = { minQty: 5, qtyUnit: 'rim', priceIdr: 2000, priceUnit: 'pcs', includesDelivery: true };
const variant = (over: Record<string, unknown> = {}) => ({
  id: 'v1', productId: 'p1', name: '30 x 30 cm', isActive: true, stockStatus: 'normal',
  priceTiers: [tier], ...over,
});

const FIXTURE_SUPREME_WITH_TWO_PHOTOS = product({ referenceImageUrls: ['https://x/1.jpg', 'https://x/2.jpg'] }, [variant()]);
const FIXTURE_NO_TIERS = product({}, [variant({ priceTiers: [] })]);

describe('catalog block', () => {
  it('renders one tier line in the exact format the price check reads', () => {
    expect(formatTierLine({ minQty: 5, qtyUnit: 'rim', priceIdr: 2000, priceUnit: 'pcs', includesDelivery: true }))
      .toBe('  • mulai 5 rim (2.500 pcs): Rp 2.000/pcs, sudah termasuk ongkir');
    expect(formatTierLine({ minQty: 10, qtyUnit: 'rim', priceIdr: 165000, priceUnit: 'rim', includesDelivery: false }))
      .toBe('  • mulai 10 rim (5.000 pcs): Rp 165.000/rim, belum termasuk ongkir');
  });

  it('lists brand, product, use, size and tiers, and marks reference photos', () => {
    const block = formatProducts([FIXTURE_SUPREME_WITH_TWO_PHOTOS]);
    expect(block).toContain('Merek: Kertas Supreme');
    expect(block).toContain('Produk: Kertas Supreme 64 gsm cetak 1 warna');
    expect(block).toContain('Kegunaan: bungkus nasi, kebab, burger');
    expect(block).toContain('- Ukuran: 30 x 30 cm');
    expect(block).toContain('  • mulai 5 rim (2.500 pcs): Rp 2.000/pcs, sudah termasuk ongkir');
    expect(block).toContain('1 rim = 500 pcs/lembar');
    expect(block).toContain(REFERENCE_PHOTOS_MARKER);
    expect(block).not.toMatch(/PRICELIST|MP\b|reseller/i);
  });

  it('no photos means no marker; null legacy fields render cleanly', () => {
    const block = formatProducts([product({ fungsi: null }, [variant()])]);
    expect(block).not.toContain(REFERENCE_PHOTOS_MARKER);
    expect(block).not.toMatch(/null|undefined|Kegunaan/);
  });

  it('a variant with no tiers says the team prices it', () =>
    expect(formatProducts([FIXTURE_NO_TIERS])).toContain('  • harga: dihitung tim'));
});

describe('gramasi in the catalog block', () => {
  const gv = (id: string, name: string, gsm: string | null, price: number, over: Record<string, unknown> = {}) =>
    variant({ id, name, gsm, priceTiers: [{ ...tier, priceIdr: price }], ...over });

  it('groups sizes under their gramasi in ascending order', () => {
    const block = formatProducts([product({ name: 'Box Makan Ivory' }, [
      gv('a', '20 x 20 x 7 cm', '300 gsm', 3000),
      gv('b', '20 x 20 x 7 cm', '270 gsm', 2500),
      gv('c', '25 x 25 x 7 cm', '270 gsm', 2800),
    ])]);
    const tierLine = (p: number) => `  • mulai 5 rim (2.500 pcs): Rp ${p.toLocaleString('id-ID')}/pcs, sudah termasuk ongkir`;
    expect(block).toContain([
      '  Gramasi 270 gsm:',
      '  - Ukuran: 20 x 20 x 7 cm',
      tierLine(2500),
      '  - Ukuran: 25 x 25 x 7 cm',
      tierLine(2800),
      '  Gramasi 300 gsm:',
      '  - Ukuran: 20 x 20 x 7 cm',
      tierLine(3000),
    ].join('\n'));
    for (const l of block.split('\n').filter((x) => x.includes('Gramasi '))) expect(l).not.toMatch(/Rp|^(Merek|Produk|Kategori): /);
  });

  it('a product without gramasi renders exactly as before', () => {
    const block = formatProducts([product({ fungsi: null }, [variant()])]);
    expect(block).not.toContain('Gramasi');
    expect(block).toBe([
      'KATALOG PRODUK RELEVAN:',
      'Harga per tingkat jumlah. Untuk harga sesuai jumlah pelanggan WAJIB panggil hitung_harga. 1 rim = 500 pcs/lembar.',
      '',
      'Merek: Kertas Supreme',
      'Produk: Kertas Supreme 64 gsm cetak 1 warna',
      '  - Ukuran: 30 x 30 cm',
      '  • mulai 5 rim (2.500 pcs): Rp 2.000/pcs, sudah termasuk ongkir',
      '',
    ].join('\n'));
  });
});

// The catalog search narrows to one brand by the customer's words (catalogDelivery.brandsInText), never
// by a brand alias table.
describe('detectBrand', () => {
  it('returns the one brand a message names', () => {
    expect(detectBrand('berapa harga kertas supreme?')).toBe('kertas_supreme');
    expect(detectBrand('kertas nasi 30x30 ada?')).toBe('kertas_supreme');
    expect(detectBrand('dus makanan ukuran 20x20')).toBe('imperial_indopack');
  });

  it('returns null for no brand, or both', () => {
    expect(detectBrand('halo kak')).toBeNull();
    expect(detectBrand('gelas plastik ukuran 16 oz')).toBeNull();
    expect(detectBrand('box dan kertas nasi')).toBeNull();
  });
});
