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

  it('joins Cetak and Finishing into the description, drops empty parts and keeps Gramasi on the size row', () => {
    const p = parseTemplateRows([
      HEADER,
      ROW(BRAND, PRODUCT, SIZE, 5, 'rim', 185000, 'rim', 'ya', { gramasi: '64 gsm', finishing: 'laminasi', kegunaan: 'Bungkus makanan' }),
    ]);
    expect(p.variants[0]).toMatchObject({
      gsm: '64 gsm',
      description: 'Finishing: laminasi',
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

  // Final review M10: "5 rim" and "2500 pcs" are one threshold. Both imported, which price applied hung on
  // sort order while the catalog block listed both.
  it('rejects two tiers at the same pcs threshold, whatever their units, and drops the variant', () => {
    const p = parseTemplateRows([
      HEADER,
      ROW(BRAND, PRODUCT, SIZE, 5, 'rim', 185000, 'rim', 'tidak'),
      ROW(BRAND, PRODUCT, SIZE, 2500, 'pcs', 370, 'pcs', 'tidak'),
      ROW(BRAND, PRODUCT, SIZE, 10, 'rim', 165000, 'rim', 'tidak'),
      ROW(BRAND, PRODUCT, '25 x 25 cm', 5, 'rim', 150000, 'rim', 'tidak'),
    ]);
    expect(p.errors).toEqual([{ row: 3, message: expect.stringContaining('2500 pcs') }]);
    expect(p.errors[0]!.message).toMatch(/jumlah yang sama|5 rim/);
    expect(p.variants.map((v) => v.size)).toEqual(['25 x 25 cm']);
  });

  it('skips blank spacer rows', () => {
    const p = parseTemplateRows([HEADER, [], ROW(BRAND, PRODUCT, SIZE, 5, 'rim', 185000, 'rim', 'ya')]);
    expect(p.errors).toEqual([]);
    expect(p.variants).toHaveLength(1);
  });

  const FIXTURE = {
    id: 'p1', name: PRODUCT, description: 'Cetak: 1 warna', fungsi: 'Bungkus nasi',
    brand: { name: BRAND },
    variants: [
      {
        name: SIZE, gsm: '64 gsm',
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
        brand: BRAND, product: PRODUCT, size: SIZE, gsm: '64 gsm',
        description: 'Cetak: 1 warna', fungsi: 'Bungkus nasi',
        tierRows: [2, 3],
        tiers: [
          { minQty: 5, qtyUnit: 'rim', priceIdr: 185000, priceUnit: 'rim', includesDelivery: false },
          { minQty: 10, qtyUnit: 'rim', priceIdr: 165000, priceUnit: 'rim', includesDelivery: true, note: 'gratis ongkir' },
        ],
      },
    ]);
  });

  it('round-trips build -> parse with two gramasi', () => {
    const tier = (priceIdr: number) => [{ minQty: 5, qtyUnit: 'rim', priceIdr, priceUnit: 'rim', includesDelivery: false }];
    const two = {
      id: 'p2', name: 'Box Contoh', description: 'Cetak: 1 warna', fungsi: null, brand: { name: BRAND },
      variants: [
        { name: '20 x 20 cm', gsm: '270 gsm', priceTiers: tier(100000) },
        { name: '20 x 20 cm', gsm: '300 gsm', priceTiers: tier(120000) },
      ],
    } as unknown as Product;
    const rows = buildTemplateRows([two]);
    expect(rows.slice(1).map((r) => r[3])).toEqual(['270 gsm', '300 gsm']);
    expect(rows.slice(1).map((r) => r[4])).toEqual(['1 warna', '1 warna']);
    const parsed = parseTemplateRows(rows);
    expect(parsed.errors).toEqual([]);
    expect(parsed.variants.map((v) => [v.gsm, v.tiers[0]!.priceIdr])).toEqual([['270 gsm', 100000], ['300 gsm', 120000]]);
  });

  it('groups rows by product, gramasi and size', () => {
    const p = parseTemplateRows([
      HEADER,
      ROW(BRAND, 'Box Contoh', '20x20', 5, 'rim', 100000, 'rim', 'tidak', { gramasi: '300' }),
      ROW(BRAND, 'Box Contoh', '20 x 20 cm', 10, 'rim', 90000, 'rim', 'tidak', { gramasi: '300 gsm' }),
      ROW(BRAND, 'Box Contoh', '20 x 20 cm', 5, 'rim', 80000, 'rim', 'tidak', { gramasi: '270 gsm' }),
    ]);
    expect(p.errors).toEqual([]);
    expect(p.variants.map((v) => [v.gsm, v.tiers.length])).toEqual([['300 gsm', 2], ['270 gsm', 1]]);
  });

  it('a product whose rows disagree on Cetak is refused, naming the row', () => {
    const p = parseTemplateRows([
      HEADER,
      ROW(BRAND, 'Box Contoh', SIZE, 5, 'rim', 100000, 'rim', 'tidak', { cetak: '1 warna' }),
      ROW(BRAND, 'Box Contoh', '40 x 40 cm', 5, 'rim', 120000, 'rim', 'tidak', { cetak: '2 warna' }),
      ROW(BRAND, 'Produk Lain Contoh', SIZE, 5, 'rim', 50000, 'rim', 'tidak'),
    ]);
    expect(p.errors).toEqual([{ row: 3, message: 'Cetak berbeda dari baris lain untuk produk "Box Contoh".' }]);
    expect(p.variants.map((v) => v.product)).toEqual(['Produk Lain Contoh']);
  });

  it('blank and filled Gramasi in one product are refused', () => {
    const p = parseTemplateRows([
      HEADER,
      ROW(BRAND, 'Box Contoh', SIZE, 5, 'rim', 100000, 'rim', 'tidak', { gramasi: '300' }),
      ROW(BRAND, 'Box Contoh', '40 x 40 cm', 5, 'rim', 120000, 'rim', 'tidak'),
    ]);
    expect(p.errors).toEqual([{ row: 3, message: 'Gramasi kosong, padahal baris lain produk "Box Contoh" punya gramasi.' }]);
    expect(p.variants).toEqual([]);
  });

  // (One product name under two brands is now a row error of its own: see the brand-clash test below.)
  it('a blank key poisons every variant matching the filled keys', () => {
    const p = parseTemplateRows([
      HEADER,
      ROW(BRAND, PRODUCT, SIZE, 5, 'rim', 185000, 'rim', 'ya'),
      ROW(BRAND, PRODUCT, '40 x 40 cm', 5, 'rim', 1, 'rim', 'ya'),
      ROW('', PRODUCT, SIZE, 10, 'rim', 165000, 'rim', 'ya'),
    ]);
    expect(p.errors.map((e) => e.row)).toEqual([4]);
    expect(p.variants.map((v) => v.size)).toEqual(['40 x 40 cm']);
  });

  it('reads whole-rupiah separators both ways and rejects decimals', () => {
    const ok = (v: unknown) => parseTemplateRows([HEADER, ROW(BRAND, PRODUCT, SIZE, 5, 'rim', v, 'rim', 'ya')]);
    expect(ok('1,500').variants[0]!.tiers[0]!.priceIdr).toBe(1500);
    expect(ok('1.250.000').variants[0]!.tiers[0]!.priceIdr).toBe(1250000);
    expect(ok(185000).variants[0]!.tiers[0]!.priceIdr).toBe(185000);
    for (const bad of ['1,5', '1500.50', 1500.5]) {
      expect(ok(bad).errors[0]!.message).toMatch(/bilangan bulat rupiah/);
    }
  });

  it('error copy matches the dialog', () => {
    const msgs = (rows: unknown[][]) => parseTemplateRows([HEADER, ...rows]).errors.map((e) => e.message);
    expect(msgs([
      ROW(BRAND, PRODUCT, SIZE, 5, 'box', 185000, 'rim', 'tidak'),
      ROW(BRAND, PRODUCT, SIZE, 10, 'rim', '0', 'rim', 'tidak'),
      ROW('', PRODUCT, SIZE, 20, 'rim', 150000, 'rim', 'tidak'),
    ])).toEqual([
      'Satuan "box" tidak dikenal. Pakai rim atau pcs.',
      'Harga 0. Harga harus lebih dari 0.',
      'Kolom Merek kosong. Isi Kertas Supreme atau Imperial Indopack.',
    ]);
    expect(msgs([ROW('Merek Lain', PRODUCT, SIZE, 5, 'rim', 185000, 'rim', 'tidak')]))
      .toEqual(['Merek "Merek Lain" tidak dikenal. Isi Kertas Supreme atau Imperial Indopack.']);
    expect(msgs([ROW(BRAND, '', SIZE, 5, 'rim', 185000, 'rim', 'tidak')])).toEqual(['Kolom Produk kosong.']);
    expect(msgs([ROW(BRAND, PRODUCT, '', 5, 'rim', 185000, 'rim', 'tidak')])).toEqual(['Kolom Ukuran kosong.']);
    expect(msgs([ROW(BRAND, PRODUCT, SIZE, 'abc', 'rim', 185000, 'rim', 'tidak')])).toEqual(['Min Qty "abc" bukan angka bulat lebih dari 0.']);
    expect(msgs([ROW(BRAND, PRODUCT, SIZE, 5, 'rim', 185000, 'dus', 'tidak')])).toEqual(['Satuan "dus" tidak dikenal. Pakai rim atau pcs.']);
  });

  it('matches the brand case-insensitively and counts rows', () => {
    const p = parseTemplateRows([HEADER, ROW('kertas supreme', PRODUCT, SIZE, 5, 'rim', 185000, 'rim', 'tidak'), ROW(BRAND, PRODUCT, SIZE, 10, 'rim', 0, 'rim', 'tidak')]);
    expect(p).toMatchObject({ totalRows: 2, validRows: 1 });
    expect(p.variants).toEqual([]); // the bad row poisons the variant
  });

  it('two spellings of one size are one variant; conflicting tiers poison it; different sizes stay apart', () => {
    const merged = parseTemplateRows([
      HEADER,
      ROW(BRAND, PRODUCT, '30x30', 5, 'rim', 185000, 'rim', 'tidak'),
      ROW(BRAND, PRODUCT, '30 x 30 cm', 10, 'rim', 165000, 'rim', 'tidak'),
    ]);
    expect(merged.errors).toEqual([]);
    expect(merged.variants).toHaveLength(1);
    expect(merged.variants[0]!.size).toBe('30x30');
    expect(merged.variants[0]!.tiers.map((t) => t.minQty)).toEqual([5, 10]);

    const clash = parseTemplateRows([
      HEADER,
      ROW(BRAND, PRODUCT, '30x30', 5, 'rim', 185000, 'rim', 'tidak'),
      ROW(BRAND, PRODUCT, '30 x 30 cm', 5, 'rim', 170000, 'rim', 'tidak'),
    ]);
    expect(clash.variants).toEqual([]);
    expect(clash.errors[0]!.message).toMatch(/muncul dua kali/);

    const apart = parseTemplateRows([
      HEADER,
      ROW(BRAND, PRODUCT, '30x30', 5, 'rim', 185000, 'rim', 'tidak'),
      ROW(BRAND, PRODUCT, '30x40', 5, 'rim', 195000, 'rim', 'tidak'),
    ]);
    expect(apart.variants).toHaveLength(2);
  });

  // Products are matched by name on apply, so one name under both brands would silently merge under the
  // first brand (and on apply the last brand would win). The clash is a row error naming the brand the
  // file already used, and it poisons that product: none of its rows import, under either brand.
  it('one product name under both brands: a row error naming the first brand, and the product is left out', () => {
    const BOX = 'Box Contoh Serbaguna';
    const p = parseTemplateRows([
      HEADER,
      ROW(BRAND, BOX, '30x30', 5, 'rim', 185000, 'rim', 'tidak'),
      ROW('Imperial Indopack', BOX, '30x30', 1000, 'pcs', 2500, 'pcs', 'tidak'),
      ROW('Imperial Indopack', BOX.toLowerCase(), '20x20', 1000, 'pcs', 2000, 'pcs', 'tidak'),
      ROW(BRAND, BOX, '40x40', 5, 'rim', 195000, 'rim', 'tidak'),
      ROW(BRAND, PRODUCT, SIZE, 5, 'rim', 185000, 'rim', 'tidak'),
    ]);
    expect(p.errors).toEqual([
      { row: 3, message: `Produk "${BOX}" sudah dipakai untuk Kertas Supreme di file ini.` },
      { row: 4, message: `Produk "${BOX.toLowerCase()}" sudah dipakai untuk Kertas Supreme di file ini.` },
    ]);
    // Neither brand's rows of the clashing product import; the other product does.
    expect(p.variants.map((v) => [v.brand, v.product, v.size])).toEqual([[BRAND, PRODUCT, SIZE]]);
    expect(p).toMatchObject({ totalRows: 5, validRows: 3 });
  });

  it('the same brand written two ways is not a clash', () => {
    const p = parseTemplateRows([
      HEADER,
      ROW(BRAND, PRODUCT, '30x30', 5, 'rim', 185000, 'rim', 'tidak'),
      ROW('KERTAS SUPREME', PRODUCT, '40x40', 5, 'rim', 195000, 'rim', 'tidak'),
    ]);
    expect(p.errors).toEqual([]);
    expect(p.variants).toHaveLength(2);
  });

  it('caps the error list at 50 while the row counts stay exact', () => {
    const rows = Array.from({ length: 60 }, (_, i) => ROW(BRAND, `${PRODUCT} ${i}`, SIZE, 5, 'box', 1000, 'rim', 'tidak'));
    const p = parseTemplateRows([HEADER, ...rows, ROW(BRAND, `${PRODUCT} ok`, SIZE, 5, 'rim', 1000, 'rim', 'tidak')]);
    expect(p.errors).toHaveLength(50);
    expect(p).toMatchObject({ totalRows: 61, validRows: 1 });
  });
});
