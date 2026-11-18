import { describe, it, expect } from 'vitest';
import { extractBlocks } from '../scripts/draft-starter-catalog.js';
import { parseTemplateRows, TEMPLATE_COLUMNS } from '../src/services/catalogTemplate.js';

// Customer-named titles are synthetic ("CONTOH ..."): the real workbook's customer names never enter the repo.
const N = null;
// HARGA BOX shape: blocks side by side in column pairs B/C and E/F.
const HARGA_BOX: unknown[][] = [
  [N, 'PENAWARAN HARGA IVORY 270 GSM', 'CETAK FULL COLOR ', N, 'PENAWARAN HARGA BOX CONTOH RESTO BIRU 350 GSM', 'CETAK 2 WARNA'],
  [N, 'QTY ORDER', 'HARGA PER PCS', N, 'QTY ORDER', 'HARGA PER PCS'],
  [N, '5 RIM / 2.500 PCS ', 1500, N, '20 RIM / 10.000 PCS', 1950],
  [N, '10 RIM / 5.000 PCS', 1300, N, '50 RIM / 25.000 PCS', 1450],
  [N, 'SUDAH TERMASUK ONGKIR KE TEMPAT TUJUAN ', N, N, 'SUDAH TERMASUK ONGKIR KE TEMPAT TUJUAN', N],
  [N, 'BOX 1 UKURAN 21 X 7 X 5 CM ', N],
];

const block = (title: string, sub: string, tiers: [string, number][], unit = 'HARGA PER PCS', size = 'UKURAN 21 X 7 X 5 CM', ongkir = 'SUDAH TERMASUK ONGKIR KE TEMPAT TUJUAN'): unknown[][] => [
  [N, title, sub],
  [N, 'QTY ORDER', unit],
  ...tiers.map(([q, p]) => [N, q, p]),
  [N, ongkir],
  [N, size],
  [],
];
const TIERS: [string, number][] = [['5 RIM / 2.500 PCS', 1500], ['10 RIM / 5.000 PCS', 1300]];

describe('extractBlocks', () => {
  it('keeps a generic block and skips a customer-named one by title only', () => {
    const { rows, skipped } = extractBlocks(HARGA_BOX);
    expect(rows.map((r) => r[1])).toEqual(['Box Ivory 270 gsm cetak full color', 'Box Ivory 270 gsm cetak full color']);
    expect(rows[0]).toEqual(['Imperial Indopack', 'Box Ivory 270 gsm cetak full color', '21 x 7 x 5 cm', '270 gsm', 'Full color', null, null, 5, 'rim', 1500, 'pcs', 'ya', null]);
    expect(rows.map((r) => r[7])).toEqual([5, 10]);
    expect(skipped).toEqual(['BOX CONTOH RESTO BIRU 350 GSM']);
    expect(JSON.stringify(skipped)).not.toMatch(/\d{3}\.?\d{3}/);
  });

  it('skips a generic block with no size', () => {
    const noSize = HARGA_BOX.slice(0, 5);
    const { rows, skipped } = extractBlocks(noSize);
    expect(rows).toEqual([]);
    expect(skipped).toContainEqual(expect.stringMatching(/^IVORY 270 GSM/));
  });

  it('skips a generic block under a customer header, and every later one in that column', () => {
    const sheet = [
      ...block('PENAWARAN HARGA CONTOH GELATO', 'CETAK 1 WARNA', TIERS),
      ...block('PENAWARAN HARGA CETAK 1 WARNA', 'UKURAN 30 X 30 CM', TIERS),
      ...block('PENAWARAN HARGA CETAK 2 WARNA', 'UKURAN 30 X 40 CM', TIERS),
    ];
    const { rows, skipped } = extractBlocks(sheet);
    expect(rows).toEqual([]);
    expect(skipped).toHaveLength(3);
    expect(skipped[0]).toBe('CONTOH GELATO');
  });

  it('keeps generic blocks above the first customer header', () => {
    const sheet = [
      ...block('PENAWARAN HARGA CETAK 1 WARNA', 'UKURAN 30 X 30 CM', TIERS, 'HARGA PER PCS'),
      ...block('PENAWARAN HARGA CONTOH GELATO', 'CETAK 1 WARNA', TIERS),
    ];
    const { rows } = extractBlocks(sheet);
    expect(rows.map((r) => r[1])).toEqual(['Kertas cetak 1 warna', 'Kertas cetak 1 warna']);
    expect(rows[0]![4]).toBe('1 warna');
  });

  it('skips a block with an empty title (fail closed)', () => {
    const { rows, skipped } = extractBlocks(block('PENAWARAN HARGA', 'UKURAN 30 X 30 CM', TIERS));
    expect(rows).toEqual([]);
    expect(skipped[0]).toMatch(/label kosong/);
  });

  it('maps CETAK clauses to the Cetak column and the product name', () => {
    const { rows } = extractBlocks(block('PENAWARAN HARGA KERTAS SUPREME 67 GSM', 'CETAK 2 WARNA FULL BLOCK', TIERS));
    expect(rows[0]![1]).toBe('Kertas Supreme 67 gsm cetak 2 warna full block');
    expect(rows[0]![4]).toBe('2 warna full block');
    const t = extractBlocks(block('PENAWARAN HARGA CETAK FULL COLOR', 'UKURAN 20 X 20 CM', TIERS));
    expect(t.rows[0]![4]).toBe('Full color');
  });

  it('drops every variant whose same tier has different prices across blocks', () => {
    const sheet = [
      ...block('PENAWARAN HARGA IVORY 270 GSM', 'CETAK FULL COLOR', TIERS),
      ...block('PENAWARAN HARGA IVORY 270 GSM', 'CETAK FULL COLOR', [['5 RIM / 2.500 PCS', 1700], ['10 RIM / 5.000 PCS', 1300]]),
    ];
    const { rows, skipped } = extractBlocks(sheet);
    expect(rows).toEqual([]);
    expect(skipped).toHaveLength(2);
  });

  it('keeps one copy of an identical repeated block', () => {
    const sheet = [...block('PENAWARAN HARGA IVORY 270 GSM', 'CETAK FULL COLOR', TIERS), ...block('PENAWARAN HARGA IVORY 270 GSM', 'CETAK FULL COLOR', TIERS)];
    expect(extractBlocks(sheet).rows).toHaveLength(2);
  });

  it('skips a single-tier block of 100 rim or more', () => {
    const { rows, skipped } = extractBlocks(block('PENAWARAN HARGA IVORY 270 GSM', 'CETAK FULL COLOR', [['100 RIM / 50.000 PCS', 1300]]));
    expect(rows).toEqual([]);
    expect(skipped[0]).toMatch(/tier tunggal/);
  });

  it('skips suspicious price units and prices that rise with quantity', () => {
    const perPcsTooBig = extractBlocks(block('PENAWARAN HARGA IVORY 270 GSM', 'CETAK FULL COLOR', [['5 RIM / 2.500 PCS', 150000], ['10 RIM / 5.000 PCS', 130000]]));
    expect(perPcsTooBig.skipped[0]).toMatch(/satuan harga mencurigakan/);
    const perRimTooSmall = extractBlocks(block('PENAWARAN HARGA IVORY 270 GSM', 'CETAK FULL COLOR', [['5 RIM / 2.500 PCS', 1500], ['10 RIM / 5.000 PCS', 1300]], 'HARGA PER RIM'));
    expect(perRimTooSmall.skipped[0]).toMatch(/satuan harga mencurigakan/);
    const rising = extractBlocks(block('PENAWARAN HARGA IVORY 270 GSM', 'CETAK FULL COLOR', [['5 RIM / 2.500 PCS', 1300], ['10 RIM / 5.000 PCS', 1500]]));
    expect(rising.skipped[0]).toMatch(/naik dengan jumlah/);
  });

  it('never puts prices in the skipped list', () => {
    const { skipped } = extractBlocks([[N, 'PENAWARAN HARGA TOKO RP 430.871 BARU 1500000', 'x'], [N, 'QTY ORDER', 'HARGA PER PCS']]);
    expect(skipped.join(' ')).not.toMatch(/RP|\d{4}|\d{3}\.\d{3}/i);
    expect(skipped[0]).toMatch(/TOKO/);
  });

  it('produces rows the catalog importer accepts', () => {
    const { rows } = extractBlocks(HARGA_BOX);
    const parsed = parseTemplateRows([[...TEMPLATE_COLUMNS], ...rows]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.variants).toHaveLength(1);
    expect(parsed.variants[0]!.tiers).toHaveLength(2);
  });
});
