/**
 * price-tool.test.ts
 * hitung_harga: the model never does price arithmetic - it calls this tool and repeats the figures.
 * The figures returned here are also the only ones the strict price check accepts for the turn, so
 * a quote's `figures` must be exactly what its text prints, and every non-quote returns none.
 *
 * Pure - fixture catalog (the cached catalog source is mocked), no DATABASE_URL, no API key.
 */

import { describe, it, expect, vi } from 'vitest';

// The default catalog source - a pure stand-in for the cached snapshot (no database).
const { mockGetCatalogProducts } = vi.hoisted(() => ({ mockGetCatalogProducts: vi.fn() }));
vi.mock('../src/services/ragQuery.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/ragQuery.js')>()),
  getCatalogProducts: mockGetCatalogProducts,
}));

import { normalizeSize, runPriceTool, PriceToolInput, PRICE_TOOL, PRICE_TOOL_DESC, PRICE_TOOL_NAME } from '../src/services/priceTool.js';
import { parseTemplateRows, TEMPLATE_COLUMNS } from '../src/services/catalogTemplate.js';
import { formatProducts } from '../src/services/ragQuery.js';
import { BOX_GRAMASI, BOX_GRAMASI_INPUT, CATALOG, IVORY_BOX, IVORY_INPUT, SUPREME, SUPREME_2, SUPREME_INPUT } from './price-fixtures.js';

describe('runPriceTool - the plan cases', () => {
  it('quotes 12 rim of Kertas Supreme 30x30', async () => {
    const r = await runPriceTool({ product: 'kertas supreme 64 gsm cetak 1 warna', size: '30 x 30 cm', qty: 12, unit: 'rim' }, CATALOG);
    expect(r.text).toMatch(/^HARGA:/); expect(r.text).toContain('Rp 165.000/rim'); expect(r.text).toContain('Rp 1.980.000');
    expect(r.figures).toEqual(expect.arrayContaining([165000, 1980000, 160000]));
  });
  it.each(['30x30', '30 x 30 cm', '30*30', '30×30', '30 X 30'])('finds size written as %s', async (s) =>
    expect((await runPriceTool({ product: 'kertas supreme 64 gsm cetak 1 warna', size: s, qty: 5, unit: 'rim' }, CATALOG)).text).toMatch(/^HARGA:/));
  it('an unknown size is not in the catalog, with no figures', async () => {
    const r = await runPriceTool({ product: 'kertas supreme 64 gsm cetak 1 warna', size: '32x32', qty: 5, unit: 'rim' }, CATALOG);
    expect(r.text).toMatch(/^TIDAK_ADA_DI_KATALOG:/); expect(r.figures).toEqual([]);
  });
  it('an empty catalog prices nothing', async () =>
    expect((await runPriceTool({ product: 'box', size: '20x20x7,5', qty: 10, unit: 'rim' }, [])).text).toMatch(/^TIDAK_ADA_DI_KATALOG:/));
  it('2.5 pcs is below the minimum', async () =>
    expect((await runPriceTool({ ...IVORY_INPUT, qty: 2.5, unit: 'pcs' }, CATALOG)).text).toMatch(/^DI_BAWAH_MINIMUM:/));
  it('a product switched off in the editor is not in the catalog, even in a catalog passed in', async () => {
    const r = await runPriceTool(IVORY_INPUT, [...CATALOG.filter((p) => p !== IVORY_BOX), { ...IVORY_BOX, isActive: false }]);
    expect(r.calls[0]!.outcome).toBe('not_in_catalog'); expect(r.figures).toEqual([]);
  });
});

describe('runPriceTool - tiers (spec 8: between tiers, top tier, above it, below the minimum, pcs vs rim)', () => {
  it('a quote returns exactly unit price, total and next-tier price, and prints each', async () => {
    const r = await runPriceTool(SUPREME_INPUT, CATALOG);
    expect(r.figures).toEqual([165000, 1980000, 160000]);
    expect(r.text).toContain('Rp 160.000/rim');
    expect(r.text).toContain('belum termasuk ongkir');
  });

  it('8 rim between the 5 and 10 rim tiers gets the 5-rim per-pcs price, over 4.000 pcs', async () => {
    const r = await runPriceTool(IVORY_INPUT, CATALOG);
    expect(r.text).toMatch(/^HARGA:/);
    expect(r.text).toContain('Rp 2.000/pcs');
    expect(r.text).toContain('4.000 pcs');
    expect(r.text).toContain('Rp 8.000.000');
    expect(r.text).toContain('sudah termasuk ongkir');
    expect(r.figures).toEqual([2000, 8_000_000, 1800]);
  });

  it('exactly the top tier is quoted, with no next-tier figure', async () => {
    const r = await runPriceTool({ ...IVORY_INPUT, qty: 20 }, CATALOG);
    expect(r.text).toMatch(/^HARGA:/);
    expect(r.figures).toEqual([1500, 15_000_000]);
  });

  it('above the top tier goes to staff, with no figures and no Rp in the text', async () => {
    const r = await runPriceTool({ ...IVORY_INPUT, qty: 21 }, CATALOG);
    expect(r.text).toMatch(/^DI_ATAS_TINGKAT_TERATAS:/);
    expect(r.text).toContain('20 rim');
    expect(r.text).not.toMatch(/Rp/);
    expect(r.figures).toEqual([]);
  });

  it('below the minimum names the minimum and quotes nothing', async () => {
    const r = await runPriceTool({ ...IVORY_INPUT, qty: 4 }, CATALOG);
    expect(r.text).toMatch(/^DI_BAWAH_MINIMUM:/);
    expect(r.text).toContain('5 rim (2.500 pcs)');
    expect(r.text).not.toMatch(/Rp/);
    expect(r.figures).toEqual([]);
  });

  it('pcs entered against a per-rim price: 2.700 pcs is 5,4 rim', async () => {
    const r = await runPriceTool({ ...SUPREME_INPUT, qty: 2700, unit: 'pcs' }, CATALOG);
    expect(r.text).toMatch(/^HARGA:/);
    expect(r.text).toContain('5,4 rim');
    expect(r.figures).toEqual([185_000, 999_000, 165_000]);
  });
});

describe('runPriceTool - what is not priceable', () => {
  it('an out-of-stock variant is not quoted', async () => {
    const r = await runPriceTool({ ...SUPREME_INPUT, size: '25x25' }, CATALOG);
    expect(r.text).toMatch(/^TIDAK_ADA_DI_KATALOG:/);
    expect(r.figures).toEqual([]);
  });

  // Task 13 carry: one out-of-stock rule - the ready sizes first, the team only if the customer insists.
  it('an out-of-stock variant names the ready sizes to offer first, not the team', async () => {
    const r = await runPriceTool({ ...SUPREME_INPUT, size: '25x25' }, CATALOG);
    expect(r.text).toContain('sedang kosong (stok habis)');
    expect(r.text).toContain('Ukuran yang ready: 30 x 30 cm, 35 x 35 cm.');
    expect(r.text).toContain('tawarkan dulu ukuran yang ready');
    expect(r.text).toContain('hanya kalau pelanggan tetap mau ukuran ini');
    expect(r.text).not.toContain('harganya dihitung tim kami');
    // The inactive 40 x 40 is never offered.
    expect(r.text).not.toContain('40 x 40');
  });

  it('an out-of-stock variant with no ready sibling says so plainly', async () => {
    const lone = { ...SUPREME, variants: SUPREME.variants!.filter((v) => v.stockStatus === 'no_stock') };
    const r = await runPriceTool({ ...SUPREME_INPUT, size: '25x25' }, [lone]);
    expect(r.text).toMatch(/^TIDAK_ADA_DI_KATALOG: .*sedang kosong \(stok habis\)\. Jangan sebut harga untuk ukuran ini; sampaikan kosong/);
    expect(r.figures).toEqual([]);
  });

  // Matches the catalog block: only no_stock hides a variant's prices there.
  it.each(['price_rise', 'price_drop'] as const)('a %s variant is quoted like a normal one', async (stockStatus) => {
    const marked = { ...SUPREME, variants: SUPREME.variants!.map((v) => (v.id === 'v-ks1-30' ? { ...v, stockStatus } : v)) };
    const r = await runPriceTool(SUPREME_INPUT, [marked, SUPREME_2, IVORY_BOX]);
    expect(r.text).toMatch(/^HARGA:/);
    expect(r.figures).toEqual([165000, 1980000, 160000]);
  });

  it('an inactive variant is not quoted', async () => {
    const r = await runPriceTool({ ...SUPREME_INPUT, size: '40x40' }, CATALOG);
    expect(r.text).toMatch(/^TIDAK_ADA_DI_KATALOG:/);
    expect(r.figures).toEqual([]);
  });

  it('a variant with no tiers is the team\'s to price', async () => {
    const r = await runPriceTool({ ...SUPREME_INPUT, size: '35x35' }, CATALOG);
    expect(r.text).toMatch(/^TIDAK_ADA_DI_KATALOG:/);
    expect(r.figures).toEqual([]);
  });

  it('an unknown product is not in the catalog', async () => {
    const r = await runPriceTool({ ...SUPREME_INPUT, product: 'paper bag kraft' }, CATALOG);
    expect(r.text).toMatch(/^TIDAK_ADA_DI_KATALOG:/);
    expect(r.figures).toEqual([]);
  });
});

describe('runPriceTool - product match', () => {
  it('a name holding every input word matches when it is the only one', async () =>
    expect((await runPriceTool({ ...IVORY_INPUT, product: 'box ivory' }, CATALOG)).text).toMatch(/^HARGA:/));

  it('words shared by two products match neither', async () => {
    const r = await runPriceTool({ ...SUPREME_INPUT, product: 'kertas supreme' }, CATALOG);
    expect(r.text).toMatch(/^TIDAK_ADA_DI_KATALOG:/);
    expect(r.figures).toEqual([]);
  });

  it('"... cetak 2 warna" gets the 2-warna product\'s own prices, not the 1-warna sibling\'s', async () => {
    const r = await runPriceTool({ ...SUPREME_INPUT, product: 'kertas supreme 64 gsm cetak 2 warna' }, CATALOG);
    expect(r.text).toMatch(/^HARGA: Kertas Supreme 64 gsm cetak 2 warna /);
    expect(r.figures).toEqual([185_000, 2_220_000, 180_000]);
    // The words alone pick it too: only the sibling has no "2".
    expect((await runPriceTool({ ...SUPREME_INPUT, product: 'supreme 2 warna' }, CATALOG)).figures).toEqual([185_000, 2_220_000, 180_000]);
  });

  it('an exact name wins over longer names that contain it', async () => {
    const longer = { ...CATALOG[2]!, id: 'p-ii2', name: 'Box Ivory 270 gsm cetak full color laminasi' };
    expect((await runPriceTool(IVORY_INPUT, [...CATALOG, longer])).text).toMatch(/^HARGA:/);
  });
});

// Final review I3: the field description said "exactly as written after 'Produk:'", and the block prints
// "Produk: <name> — <description>"; every imported product's description is its spec columns. Copying the
// line returned TIDAK_ADA_DI_KATALOG, and Pricing rule (d) handed an in-catalog item to the team.
describe('runPriceTool - the product name as the catalog block prints it', () => {
  // The description the real import writes: the Cetak / Finishing columns of the template row (Gramasi is per size row).
  const imported = parseTemplateRows([
    [...TEMPLATE_COLUMNS],
    ['Kertas Supreme', SUPREME.name, '30 x 30 cm', '64 gsm', '1 warna', null, null, 5, 'rim', 185000, 'rim', 'tidak', null],
  ]).variants[0]!;
  const product = { ...SUPREME, description: imported.description };
  const produkLine = formatProducts([product]).split('\n').find((l) => l.startsWith('Produk: '))!.slice('Produk: '.length);

  it('prices the whole "Produk:" line copied from the block, description and all', async () => {
    expect(produkLine).toBe(`${SUPREME.name} — Cetak: 1 warna`);
    expect((await runPriceTool({ ...SUPREME_INPUT, product: produkLine }, [product, SUPREME_2, IVORY_BOX])).text).toMatch(/^HARGA: Kertas Supreme 64 gsm cetak 1 warna /);
  });

  it('strips a " - " suffix too', async () =>
    expect((await runPriceTool({ ...SUPREME_INPUT, product: `${SUPREME.name} - Gramasi: 64 gsm` }, CATALOG)).text).toMatch(/^HARGA:/));

  it('"64gsm" is "64 gsm", whatever the spacing and case', async () => {
    expect((await runPriceTool({ ...SUPREME_INPUT, product: 'kertas supreme 64gsm cetak 1 warna' }, CATALOG)).text).toMatch(/^HARGA:/);
    expect((await runPriceTool({ ...SUPREME_INPUT, product: '  KERTAS   SUPREME 64 GSM cetak 1 warna ' }, CATALOG)).text).toMatch(/^HARGA:/);
  });

  it('a name that itself holds " - " still matches exactly', async () => {
    const dashed = { ...IVORY_BOX, id: 'p-dash', name: 'Box Nasi - Kraft' };
    expect((await runPriceTool({ ...IVORY_INPUT, product: 'Box Nasi - Kraft' }, [...CATALOG, dashed])).text).toMatch(/^HARGA: Box Nasi - Kraft /);
  });

  it('with no match, lists up to 3 closest product names so the model can call again', async () => {
    const more = ['Kertas Supreme 70 gsm polos', 'Kertas Supreme 64 gsm cetak 3 warna', 'Box Nasi Kraft'].map((name, i) => ({ ...SUPREME, id: `p-x${i}`, name }));
    const r = await runPriceTool({ ...SUPREME_INPUT, product: 'kertas supreme 80 gsm cetak 1 warna' }, [...CATALOG, ...more]);
    expect(r.text).toMatch(/^TIDAK_ADA_DI_KATALOG:/);
    const listed = /Nama produk terdekat di katalog: ([^.]+)\./.exec(r.text)![1]!.split('; ');
    expect(listed).toHaveLength(3);
    expect(listed[0]).toBe('Kertas Supreme 64 gsm cetak 1 warna');
    expect(listed).not.toContain('Box Nasi Kraft');
    expect(r.text).toMatch(/panggil hitung_harga lagi/);
    expect(r.figures).toEqual([]);
  });

  it('lists nothing when no name shares a word', async () => {
    const r = await runPriceTool({ ...SUPREME_INPUT, product: 'paper bag' }, CATALOG);
    expect(r.text).not.toContain('terdekat');
  });

  it('the field description names the part before " — "', () =>
    expect(PRICE_TOOL.input_schema.properties!['product']).toMatchObject({ description: expect.stringContaining('the part before " — "') }));
});

describe('runPriceTool - two variants with one size and gramasi', () => {
  const twin = (names: string[]) => [{
    ...SUPREME,
    variants: names.map((name, i) => ({ ...SUPREME.variants![0]!, id: `v-twin-${i}`, name, gsm: '64 gsm' })),
  }];

  it('is the team\'s to check, said as such, never a guess between them', async () => {
    const r = await runPriceTool({ ...SUPREME_INPUT, size: '30x30' }, twin(['30 x 30 cm', '30x30']));
    expect(r.text).toMatch(/^TIDAK_ADA_DI_KATALOG:/);
    expect(r.text).toContain('lebih dari satu varian');
    expect(r.text).not.toContain('tidak ada di katalog');
    expect(r.figures).toEqual([]);
  });

  it('lists that size once among the sizes there are', async () => {
    const r = await runPriceTool({ ...SUPREME_INPUT, size: '32x32' }, twin(['30 x 30 cm', '30x30', '25 x 25 cm']));
    expect(r.text).toContain('Ukuran yang ada: 30 x 30 cm, 25 x 25 cm.');
  });

  it('an unknown size is a custom order: no price, the team calculates it', async () => {
    const r = await runPriceTool({ ...SUPREME_INPUT, size: '32x32' }, twin(['30 x 30 cm', '25 x 25 cm']));
    expect(r.text).toMatch(/pesanan custom[^.]*dihitung tim[^\n]*jangan sebut harga[^\n]*confidence "low"/);
    expect(r.figures).toEqual([]);
  });
});

describe('runPriceTool - gramasi', () => {
  const withRows = (edit: (rows: typeof BOX_GRAMASI.variants & object) => unknown[]) => [{ ...BOX_GRAMASI, variants: edit(BOX_GRAMASI.variants!) as typeof BOX_GRAMASI.variants }];
  const byGsm = (gsm: string) => (v: { gsm: string | null }) => v.gsm === gsm;

  it('no gramasi given lists every gramasi, ascending, with figures from the quote lines only', async () => {
    const r = await runPriceTool(BOX_GRAMASI_INPUT, [BOX_GRAMASI]);
    expect(r.text.split('\n')).toEqual([
      'HARGA: Box Makan Ivory (CONTOH) ukuran 20x20x7, 8 rim (4.000 pcs), per gramasi:',
      '270 gsm: Rp 2.000/pcs, total Rp 8.000.000, sudah termasuk ongkir.',
      '300 gsm: Rp 2.500/pcs, total Rp 10.000.000, sudah termasuk ongkir.',
      'Sampaikan angka-angka ini persis seperti tertulis.',
    ]);
    expect(r.figures).toEqual([2000, 8_000_000, 2500, 10_000_000]);
    expect(r.calls.map((c) => [c.gsm, c.outcome])).toEqual([['270 gsm', 'quote'], ['300 gsm', 'quote']]);
  });

  it('a chosen gramasi quotes only that one, matching "300" to "300 gsm"', async () => {
    for (const g of ['300', '300gsm', '300 GSM']) {
      const r = await runPriceTool({ ...BOX_GRAMASI_INPUT, gramasi: g }, [BOX_GRAMASI]);
      expect(r.text).toMatch(/^HARGA: Box Makan Ivory \(CONTOH\) ukuran 20x20x7 gramasi 300 gsm, 8 rim/);
      expect(r.text).not.toContain('270');
      expect(r.figures).toEqual([2500, 10_000_000, 2300]);
      expect(r.calls).toHaveLength(1);
      expect(r.calls[0]).toMatchObject({ gsm: '300 gsm', outcome: 'quote' });
    }
  });

  it('a gramasi the size does not have is TIDAK_ADA with the list', async () => {
    const r = await runPriceTool({ ...BOX_GRAMASI_INPUT, gramasi: '350' }, [BOX_GRAMASI]);
    expect(r.text).toMatch(/^TIDAK_ADA_DI_KATALOG: Box Makan Ivory \(CONTOH\) ukuran 20x20x7 tidak ada gramasi 350 gsm\. Gramasi yang ada: 270 atau 300 gsm\./);
    expect(r.figures).toEqual([]);
    expect(r.calls[0]).toMatchObject({ outcome: 'not_in_catalog', quote: null });
  });

  it('one gramasi out of stock: that line says stok habis, the other is quoted', async () => {
    const catalog = withRows((rows) => rows.map((v) => (v.gsm === '300 gsm' ? { ...v, stockStatus: 'no_stock' } : v)));
    const r = await runPriceTool(BOX_GRAMASI_INPUT, catalog);
    expect(r.text.split('\n').slice(0, 3)).toEqual([
      'HARGA: Box Makan Ivory (CONTOH) ukuran 20x20x7, 8 rim (4.000 pcs), per gramasi:',
      '270 gsm: Rp 2.000/pcs, total Rp 8.000.000, sudah termasuk ongkir.',
      '300 gsm: stok habis',
    ]);
    expect(r.figures).toEqual([2000, 8_000_000]);
    expect(r.calls.map((c) => c.outcome)).toEqual(['quote', 'not_in_catalog']);
  });

  it('below the minimum for one gramasi only: per-line outcomes, prefix HARGA', async () => {
    const catalog = withRows((rows) => rows.map((v) => (v.gsm === '300 gsm' ? { ...v, priceTiers: v.priceTiers!.map((t) => ({ ...t, minQty: t.minQty + 4 })) } : v)));
    const r = await runPriceTool({ ...BOX_GRAMASI_INPUT, qty: 6 }, catalog);
    expect(r.text).toMatch(/^HARGA: /);
    expect(r.text).toContain('270 gsm: Rp 2.000/pcs, total Rp 6.000.000, sudah termasuk ongkir.');
    expect(r.text).toContain('300 gsm: minimal 9 rim (4.500 pcs)');
    expect(r.figures).toEqual([2000, 6_000_000]);
    expect(r.calls.map((c) => c.outcome)).toEqual(['quote', 'below_minimum']);
  });

  it('none quotes and all are below minimum: DI_BAWAH_MINIMUM', async () => {
    const r = await runPriceTool({ ...BOX_GRAMASI_INPUT, qty: 2 }, [BOX_GRAMASI]);
    expect(r.text).toMatch(/^DI_BAWAH_MINIMUM: Box Makan Ivory \(CONTOH\) ukuran 20x20x7, 2 rim \(1.000 pcs\), per gramasi:/);
    expect(r.text).toContain('270 gsm: minimal 5 rim (2.500 pcs)');
    expect(r.text).not.toMatch(/Rp/);
    expect(r.figures).toEqual([]);
  });

  it('none quotes and the outcomes differ: TIDAK_ADA', async () => {
    const catalog = withRows((rows) => rows.map((v) => (v.gsm === '300 gsm' ? { ...v, stockStatus: 'no_stock' } : v)));
    const r = await runPriceTool({ ...BOX_GRAMASI_INPUT, qty: 2 }, catalog);
    expect(r.text).toMatch(/^TIDAK_ADA_DI_KATALOG: .*per gramasi:/);
    expect(r.text).toContain('300 gsm: stok habis');
    expect(r.figures).toEqual([]);
  });

  it('none quotes and all are above the top tier: DI_ATAS_TINGKAT_TERATAS', async () => {
    const r = await runPriceTool({ ...BOX_GRAMASI_INPUT, qty: 200 }, [BOX_GRAMASI]);
    expect(r.text).toMatch(/^DI_ATAS_TINGKAT_TERATAS: /);
    expect(r.text).toContain('300 gsm: harga dihitung tim');
    expect(r.figures).toEqual([]);
  });

  it('single-gramasi product text is unchanged', async () => {
    const single = { ...IVORY_BOX, variants: IVORY_BOX.variants!.map((v) => ({ ...v, gsm: '270 gsm' })) };
    const plain = await runPriceTool(IVORY_INPUT, [IVORY_BOX]);
    const r = await runPriceTool(IVORY_INPUT, [single]);
    expect(r.text).toBe(plain.text);
    expect(r.figures).toEqual(plain.figures);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]).toMatchObject({ gsm: '270 gsm', outcome: 'quote' });
    expect(plain.calls[0]!.gsm).toBeNull();
    // Naming its only gramasi changes nothing either.
    expect((await runPriceTool({ ...IVORY_INPUT, gramasi: '270' }, [single])).text).toBe(plain.text);
  });

  it('the same gsm and size twice is the duplicate error; the same size under different gsm is not', async () => {
    const twice = withRows((rows) => [...rows, { ...rows.find(byGsm('300 gsm'))!, id: 'v-dup', name: '20 x 20 x 7' }]);
    const r = await runPriceTool(BOX_GRAMASI_INPUT, twice);
    expect(r.text).toMatch(/^TIDAK_ADA_DI_KATALOG:.*lebih dari satu varian/);
    expect(r.figures).toEqual([]);
    expect((await runPriceTool(BOX_GRAMASI_INPUT, [BOX_GRAMASI])).text).toMatch(/^HARGA:/);
  });

  it('gramasi is optional in both schemas', () => {
    expect(PriceToolInput.safeParse(BOX_GRAMASI_INPUT).success).toBe(true);
    expect(PriceToolInput.safeParse({ ...BOX_GRAMASI_INPUT, gramasi: '300 gsm' }).success).toBe(true);
    expect(PRICE_TOOL.input_schema.properties!['gramasi']).toMatchObject({ type: 'string' });
    expect(PRICE_TOOL.input_schema.required).not.toContain('gramasi');
  });

  // Final review I4: a model that sends "gramasi": null has not chosen one - accepted, never a validation error.
  it('gramasi null is accepted and lists every gramasi, as when it is left out', async () => {
    const parsed = PriceToolInput.safeParse({ ...BOX_GRAMASI_INPUT, gramasi: null });
    expect(parsed.success).toBe(true);
    const r = await runPriceTool(parsed.data!, [BOX_GRAMASI]);
    expect(r.text).toBe((await runPriceTool(BOX_GRAMASI_INPUT, [BOX_GRAMASI])).text);
    // The JSON schema the Messages API sees stays a plain optional string.
    expect(PRICE_TOOL.input_schema.properties!['gramasi']).toEqual({ type: 'string', description: expect.any(String) });
  });

  // Final review I2: a size sold under one gramasi of a product with several still names it.
  it('a size only one gramasi of a multi-gramasi product sells names that gramasi', async () => {
    const catalog = withRows((rows) => [...rows, { ...rows.find(byGsm('270 gsm'))!, id: 'v-ii2-16', name: '16x16x6' }]);
    const input = { ...BOX_GRAMASI_INPUT, size: '16x16x6' };
    const r = await runPriceTool(input, catalog);
    expect(r.text).toMatch(/^HARGA: Box Makan Ivory \(CONTOH\) ukuran 16x16x6 gramasi 270 gsm, 8 rim/);
    expect(r.calls[0]).toMatchObject({ gsm: '270 gsm', outcome: 'quote' });
    // Choosing it reads the same; the other outcomes name it too.
    expect((await runPriceTool({ ...input, gramasi: '270' }, catalog)).text).toBe(r.text);
    expect((await runPriceTool({ ...input, qty: 2 }, catalog)).text).toMatch(/^DI_BAWAH_MINIMUM: Minimal pemesanan Box Makan Ivory \(CONTOH\) ukuran 16x16x6 gramasi 270 gsm adalah/);
  });

  // Final review I3 (Ruling 15 reverses Ruling 11): a product with no gramasi rows ignores the gramasi,
  // as before this branch - the old-style name already carries it.
  it('a gramasi passed for a product with no gramasi rows is ignored: the normal quote', async () => {
    const plain = await runPriceTool(SUPREME_INPUT, CATALOG);
    for (const g of ['64 gsm', '300']) {
      const r = await runPriceTool({ ...SUPREME_INPUT, gramasi: g }, CATALOG);
      expect(r.text).toBe(plain.text);
      expect(r.text).toMatch(/^HARGA: Kertas Supreme 64 gsm cetak 1 warna ukuran 30 x 30 cm, 12 rim/);
      expect(r.figures).toEqual(plain.figures);
      expect(r.calls[0]).toMatchObject({ outcome: 'quote', gsm: null });
    }
  });
});

describe('runPriceTool - the catalog source', () => {
  it('prices from the cached catalog when no catalog is passed', async () => {
    mockGetCatalogProducts.mockResolvedValueOnce(CATALOG);
    expect((await runPriceTool(SUPREME_INPUT)).figures).toEqual([165000, 1980000, 160000]);
  });

  it('a catalog that cannot be loaded prices nothing and does not throw', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetCatalogProducts.mockRejectedValueOnce(new Error('db down'));

    const r = await runPriceTool(SUPREME_INPUT);

    expect(r.text).toMatch(/^TIDAK_ADA_DI_KATALOG:/);
    expect(r.text).toContain('tidak bisa dihitung');
    expect(r.text).not.toMatch(/Rp/);
    expect(r.figures).toEqual([]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('normalizeSize', () => {
  it.each([
    ['30 x 30 cm', '30x30'],
    ['30*30', '30x30'],
    ['30×30', '30x30'],
    ['30 X 30', '30x30'],
    ['30x30cm', '30x30'],
    ['20 x 20 x 7,5', '20x20x7.5'],
    ['20x20x7.5 cm', '20x20x7.5'],
  ])('%s -> %s', (input, expected) => expect(normalizeSize(input)).toBe(expected));
});

describe('the tool contract', () => {
  it('the API schema and the zod schema name the same required fields', () => {
    expect(PRICE_TOOL.name).toBe(PRICE_TOOL_NAME);
    expect(PRICE_TOOL_NAME).toBe('hitung_harga');
    expect(PRICE_TOOL.input_schema.required).toEqual(Object.keys(PriceToolInput.shape).filter((k) => k !== 'gramasi'));
  });

  // Final review M-c: the description says what the optional field does and what comes back without it.
  it('the description names the optional gramasi and the per-gramasi result', () => {
    expect(PRICE_TOOL.description).toBe(PRICE_TOOL_DESC);
    expect(PRICE_TOOL_DESC).toMatch(/gramasi[^.]*optional|optional[^.]*gramasi/i);
    expect(PRICE_TOOL_DESC).toMatch(/one line per gramasi/i);
  });
});

describe('runPriceTool - the call record', () => {
  it('a quote call carries the match and the quote', async () => {
    const { calls: [call] } = await runPriceTool({ product: 'kertas supreme 64 gsm cetak 1 warna', size: '30x30', qty: 12, unit: 'rim' }, CATALOG);
    expect(call).toMatchObject({ outcome: 'quote', productName: 'Kertas Supreme 64 gsm cetak 1 warna', quote: { kind: 'quote', unitPriceIdr: 165000, totalIdr: 1980000 } });
    expect(call.variantName).not.toBeNull();
  });
  it.each([[3, 'below_minimum'], [21, 'above_top_tier']] as const)('%i rim is %s', async (qty, outcome) => {
    const { calls: [call] } = await runPriceTool({ ...SUPREME_INPUT, qty, unit: 'rim' }, CATALOG);
    expect(call.outcome).toBe(outcome);
    expect(call.quote?.kind).toBe(outcome);
  });
  it('an unknown size is not_in_catalog with a null quote', async () =>
    expect((await runPriceTool({ ...SUPREME_INPUT, size: '32x32' }, CATALOG)).calls[0]).toMatchObject({ outcome: 'not_in_catalog', quote: null, productName: 'Kertas Supreme 64 gsm cetak 1 warna' }));
  it.each([
    ['no product match', { ...SUPREME_INPUT, product: 'paper bag kraft' }],
    ['no tiers', { ...SUPREME_INPUT, size: '35x35' }],
    ['no stock', { ...SUPREME_INPUT, size: '25x25' }],
  ])('%s is not_in_catalog', async (_n, input) =>
    expect((await runPriceTool(input, CATALOG)).calls[0]).toMatchObject({ outcome: 'not_in_catalog', quote: null, input }));
});
