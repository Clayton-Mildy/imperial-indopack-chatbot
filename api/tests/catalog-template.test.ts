import { describe, it, expect } from 'vitest';
import { TEMPLATE_COLUMNS, buildTemplateRows, parseTemplateRows } from '../src/services/catalogTemplate.js';
import type { Product } from '../src/domain/types.js';

const HEADER = [...TEMPLATE_COLUMNS];
const BRAND = 'Kertas Supreme';
const PRODUCT = 'Kertas Supreme 64 gsm cetak 1 warna';
const SIZE = '30 x 30 cm';

/** One tier row: Merek, Produk, Ukuran, Gramasi, Cetak, Finishing, Kegunaan, Min Qty, Satuan Qty, Harga, Satuan Harga, Ongkir, Catatan */
const ROW = (
  brand: string, product: string, size: string,
  minQty: unknown, qtyUnit: string, price: unknown, priceUnit: string, delivery: string,
  extra: { gramasi?: string; cetak?: string; finishing?: string; kegunaan?: string; note?: string } = {}
): unknown[] => [
  brand, product, size, extra.gramasi ?? null, extra.cetak ?? null, extra.finishing ?? null, extra.kegunaan ?? null,
  minQty, qtyUnit, price, priceUnit, delivery, extra.note ?? null,
];

describe('parseTemplateRows', () => {
  it('groups tier rows into one variant', () => {
    const p = parseTemplateRows([
      HEADER,
      ROW(BRAND, PRODUCT, SIZE, '5', 'rim', '185.000', 'rim', 'tidak'),
      ROW(BRAND, PRODUCT, SIZE, '10', 'rim', 165000, 'rim', 'tidak'),
    ]);
    expect(p.errors).toEqual([]);
    expect(p.variants).toHaveLength(1);
    expect(p.variants[0]!.tiers.map((t) => t.priceIdr)).toEqual([185000, 165000]);
  });

  it('reports a bad unit, a zero price and a missing brand by row number', () => {
    const p = parseTemplateRows([
      HEADER,
      ROW(BRAND, PRODUCT, SIZE, '5', 'box', '185000', 'rim', 'tidak'),
      ROW(BRAND, PRODUCT, SIZE, '10', 'rim', '0', 'rim', 'tidak'),
      ROW('', PRODUCT, SIZE, '20', 'rim', '150000', 'rim', 'tidak'),
    ]);
    expect(p.errors.map((e) => e.row)).toEqual([2, 3, 4]);
    expect(p.variants).toEqual([]);
  });

  it('refuses a header that is not the template', () => {
    expect(parseTemplateRows([['Nama Produk', 'Harga']]).errors[0]!.message).toMatch(/template/i);
  });

  it('joins Gramasi, Cetak and Finishing into the description and drops empty parts', () => {
    const p = parseTemplateRows([
      HEADER,
      ROW(BRAND, PRODUCT, SIZE, 5, 'rim', 185000, 'rim', 'ya', { gramasi: '64 gsm', finishing: 'laminasi', kegunaan: 'Bungkus makanan' }),
    ]);
    expect(p.variants[0]).toMatchObject({
      description: 'Gramasi: 64 gsm · Finishing: laminasi',
      fungsi: 'Bungkus makanan',
    });
    expect(p.variants[0]!.tiers[0]!.includesDelivery).toBe(true);
  });

  it('accepts Ya/TIDAK in any case, 1.500 thousands and a note', () => {
    const p = parseTemplateRows([
      HEADER,
      ROW(BRAND, PRODUCT, SIZE, '1.500', 'pcs', '1.500', 'pcs', 'YA', { note: ' promo ' }),
    ]);
    expect(p.errors).toEqual([]);
    expect(p.variants[0]!.tiers[0]).toEqual({
      minQty: 1500, qtyUnit: 'pcs', priceIdr: 1500, priceUnit: 'pcs', includesDelivery: true, note: 'promo',
    });
  });

  it('rejects an unreadable delivery flag and a duplicate tier', () => {
    const p = parseTemplateRows([
      HEADER,
      ROW(BRAND, PRODUCT, SIZE, 5, 'rim', 185000, 'rim', 'mungkin'),
      ROW(BRAND, PRODUCT, SIZE, 5, 'rim', 185000, 'rim', 'ya'),
      ROW(BRAND, PRODUCT, SIZE, 5, 'rim', 180000, 'rim', 'ya'),
    ]);
    expect(p.errors.map((e) => e.row)).toEqual([2, 4]);
  });

  it('skips blank spacer rows', () => {
    const p = parseTemplateRows([HEADER, [], ROW(BRAND, PRODUCT, SIZE, 5, 'rim', 185000, 'rim', 'ya')]);
    expect(p.errors).toEqual([]);
    expect(p.variants).toHaveLength(1);
  });

  const FIXTURE = {
    id: 'p1', name: PRODUCT, description: 'Gramasi: 64 gsm · Cetak: 1 warna', fungsi: 'Bungkus nasi',
    brand: { name: BRAND },
    variants: [
      {
        name: SIZE,
        priceTiers: [
          { minQty: 5, qtyUnit: 'rim', priceIdr: 185000, priceUnit: 'rim', includesDelivery: false },
          { minQty: 10, qtyUnit: 'rim', priceIdr: 165000, priceUnit: 'rim', includesDelivery: true, note: 'gratis ongkir' },
        ],
      },
      { name: '40 x 40 cm', priceTiers: [] },
    ],
  } as unknown as Product;

  it('round-trips build -> parse', () => {
    expect(parseTemplateRows(buildTemplateRows([FIXTURE])).variants).toEqual([
      {
        brand: BRAND, product: PRODUCT, size: SIZE,
        description: 'Gramasi: 64 gsm · Cetak: 1 warna', fungsi: 'Bungkus nasi',
        tiers: [
          { minQty: 5, qtyUnit: 'rim', priceIdr: 185000, priceUnit: 'rim', includesDelivery: false },
          { minQty: 10, qtyUnit: 'rim', priceIdr: 165000, priceUnit: 'rim', includesDelivery: true, note: 'gratis ongkir' },
        ],
      },
    ]);
  });
});
