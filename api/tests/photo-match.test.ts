/**
 * photo-match.test.ts
 *
 * The customer's photo against our own product photos (services/photoMatch.ts). Product photo
 * first, a variant's only when the product has none; products without any photo are not compared,
 * and an empty catalog skips the whole step so the photo turn is as fast as before.
 *
 * Mocked model, search and DB - no DATABASE_URL. Reference photos are real files, removed afterwards.
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import sharp from 'sharp';

const mockCreate = vi.fn();
const mockAgentQuery = vi.fn();
let devMode = false;
vi.mock('../src/services/claude.js', () => ({
  getClient: () => ({ messages: { create: mockCreate } }),
  isDevMode: () => devMode,
  agentQuery: mockAgentQuery,
  logUsageLine: vi.fn(),
  CLAUDE_MODEL: 'test-model',
}));
const mockSearch = vi.fn();
vi.mock('../src/repositories/products.js', () => ({ searchActiveProducts: mockSearch }));
let hasPhotos = true;
vi.mock('../src/db/client.js', () => ({ getDb: () => ({ execute: async () => ({ rows: [{ has: hasPhotos }] }) }) }));

const DIR = '/uploads/__photomatch_test__';
const product = (name: string, imageUrl: string | null, variantImages: (string | null)[] = []) => ({
  id: name, name, imageUrl, brand: { name: 'Blossom' },
  variants: variantImages.map((u, i) => ({ id: `${name}-${i}`, name: `V${i}`, imageUrl: u })),
}) as never;

function verdict(json: object) {
  mockCreate.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify(json) }], usage: { input_tokens: 1, output_tokens: 1 } });
}

async function load() {
  vi.resetModules(); // photoMatch caches "does the catalog have photos" for 5 minutes
  return import('../src/services/photoMatch.js');
}

beforeAll(async () => {
  await mkdir(join(process.cwd(), DIR), { recursive: true });
  const img = await sharp({ create: { width: 800, height: 800, channels: 3, background: '#aaa' } }).png().toBuffer();
  for (const f of ['a.png', 'b.png']) await writeFile(join(process.cwd(), DIR, f), img);
});
afterAll(() => rm(join(process.cwd(), DIR), { recursive: true, force: true }));
beforeEach(() => { vi.clearAllMocks(); hasPhotos = true; devMode = false; });

const customer = { base64: 'QUJD', mimeType: 'image/jpeg' };

describe('which photo a product is compared by', () => {
  it('uses the product photo first, a variant photo only when the product has none', async () => {
    const { referenceImageUrl } = await load();
    expect(referenceImageUrl(product('A', '/p.jpg', ['/v.jpg']))).toBe('/p.jpg');
    expect(referenceImageUrl(product('B', null, [null, '/v2.jpg', '/v3.jpg']))).toBe('/v2.jpg');
    expect(referenceImageUrl(product('C', null, [null]))).toBeNull();
  });
});

describe('comparing', () => {
  it('compares only products that have a photo, product photo first, and returns the verdict', async () => {
    const { matchCustomerPhoto } = await load();
    mockSearch.mockResolvedValue([
      product('GEMBOK KOTAK CHROME PANJANG', `${DIR}/a.png`),
      product('GEMBOK TANPA FOTO', null),
      product('GEMBOK BULAT PUTIH', null, [`${DIR}/b.png`]),
    ]);
    verdict({ match: 'B', certainty: 'similar', reason: 'bulat, warna putih' });

    const m = await matchCustomerPhoto(customer, ['gembok', 'putih'], 'ada ini kak?');

    const content = mockCreate.mock.calls[0]![0].messages[0].content as { type: string; text?: string }[];
    const labels = content.filter((c) => c.text?.startsWith('FOTO KATALOG')).map((c) => c.text);
    // Pictures only, lettered: a product name next to the photo steered the pick (2026-10-12).
    expect(labels).toEqual(['FOTO KATALOG A:', 'FOTO KATALOG B:']);
    expect(JSON.stringify(content)).not.toContain('GEMBOK');
    expect(content.filter((c) => c.type === 'image')).toHaveLength(3); // customer + two references
    expect(m).toMatchObject({ certainty: 'similar', product: { name: 'GEMBOK BULAT PUTIH', imageUrl: `${DIR}/b.png` } });
    expect(m!.compared).toEqual(['GEMBOK KOTAK CHROME PANJANG', 'GEMBOK BULAT PUTIH']);
  });

  it('ranks among photographed products only, without the caption\'s chat filler', async () => {
    // Prod 2026-10-09: a top-25 search filtered to photographed products afterwards left one
    // candidate - every handle name matched "handle", and the photographed one ranked below 25.
    const { pickCandidates } = await load();
    mockSearch.mockResolvedValue([]);
    await pickCandidates(['handle', 'pintu'], 'yang kaya gini ada ga? guangzhou');
    expect(mockSearch).toHaveBeenCalledWith({ keywords: ['handle', 'pintu', 'guangzhou'], limit: 20, withPhoto: true });
  });

  // Live 2026-10-15: our own SATURNUS photo, described "rosette persegi", was not among the 20 compared.
  it('adds the catalog\'s style word for what the photo words describe', async () => {
    const { shortlistTerms, pickCandidates } = await load();
    for (const seen of ['rosette persegi', 'rosset persegi', 'roset bulat'])
      expect(shortlistTerms(['handle', seen, 'silver'], 'mau beli ini dong, ada ga?')).toContain('pisah');
    expect(shortlistTerms(['handle', 'plat panjang', 'silver'], 'ada ga?')).not.toContain('pisah');
    // ALEXANDER's long plate, as the vision step described it 6/6
    expect(shortlistTerms(['handle', 'roset', 'plat panjang', 'roset persegi panjang'], 'kalau ini?')).not.toContain('pisah');
    expect(shortlistTerms(['handle', 'pisah', 'roset kotak'], '').filter((t) => t === 'pisah')).toHaveLength(1);

    mockSearch.mockResolvedValue([]);
    await pickCandidates(['handle', 'rosette persegi'], 'lagi cari ini');
    expect(mockSearch.mock.calls[0]![0].keywords).toContain('pisah');
  });

  it('reports the words it searched with, for the log', async () => {
    const { matchCustomerPhoto } = await load();
    mockSearch.mockResolvedValue([product('HANDLE PISAH SATURNUS', `${DIR}/a.png`)]);
    verdict({ match: 'A', certainty: 'same', reason: 'x' });
    const m = await matchCustomerPhoto(customer, ['handle', 'rosette persegi'], 'ada ga?');
    expect(m!.searched).toEqual(['handle', 'rosette persegi', 'pisah']);
  });

  it('skips the whole step while no product has a photo - no search, no model call', async () => {
    const { matchCustomerPhoto } = await load();
    hasPhotos = false;
    expect(await matchCustomerPhoto(customer, new Promise(() => { }), 'ada ini?')).toBeNull();
    expect(mockSearch).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('has nothing to say when none of the likely products has a photo', async () => {
    const { matchCustomerPhoto } = await load();
    mockSearch.mockResolvedValue([product('GEMBOK TANPA FOTO', null)]);
    expect(await matchCustomerPhoto(customer, ['gembok'], '')).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('never fails the turn when the model call does', async () => {
    const { matchCustomerPhoto } = await load();
    mockSearch.mockResolvedValue([product('A', `${DIR}/a.png`)]);
    mockCreate.mockRejectedValue(new Error('429'));
    expect(await matchCustomerPhoto(customer, ['gembok'], '')).toBeNull();
  });
});

// Production 2026-10-12: with no SATURNUS among the candidates, Haiku called our SATURNUS photo
// "same ALEXANDER". The Claude Code route compares on Sonnet, and on Haiku only when it must.
// Live 2026-10-25: customers' photos were whole phone screenshots (720x1600) of marketplace and TikTok
// listings, shrunk to 240x512 for the comparison - the handle a ~200px patch among prices and buttons.
// Black plate handles came back "silver" and similar to our silver AUSTENIC / KOBE, a black window
// rambuncis similar to our OVERVAL PLAT and GRENDEL ALUMINIUM.
describe('the customer photo, cropped to the product', () => {
  // 400x800 with an app bar at top and bottom (so framed()'s border trim cannot do the crop itself),
  // a red product at x 100-200, y 500-600: box [25, 62.5, 50, 75] in percent.
  const screenshot = async () => {
    const block = (w: number, h: number, c: string) => sharp({ create: { width: w, height: h, channels: 3, background: c } }).png().toBuffer();
    const buf = await sharp({ create: { width: 400, height: 800, channels: 3, background: '#fff' } })
      .composite([
        { input: await block(400, 60, '#00f'), left: 0, top: 0 },
        { input: await block(400, 60, '#0a0'), left: 0, top: 740 },
        { input: await block(100, 100, '#f00'), left: 100, top: 500 },
      ]).jpeg().toBuffer();
    return { base64: buf.toString('base64'), mimeType: 'image/jpeg' };
  };

  it('cuts the photo down to the box the vision step found, with a margin', async () => {
    const { cropToProduct } = await load();
    const out = await cropToProduct(await screenshot(), [25, 62.5, 50, 75]);
    const meta = await sharp(Buffer.from(out.base64, 'base64')).metadata();
    expect(meta.width).toBeGreaterThan(100);
    expect(meta.width).toBeLessThan(160);
    expect(meta.height).toBeGreaterThan(100);
    expect(meta.height).toBeLessThan(160);
  });

  it('keeps the whole photo when there is no usable box', async () => {
    const { cropToProduct } = await load();
    const shot = await screenshot();
    expect(await cropToProduct(shot, null)).toBe(shot);
    expect(await cropToProduct(shot, [0, 0, 100, 100])).toBe(shot); // the product already fills it
    expect(await cropToProduct(shot, [50, 50, 50.5, 50.5])).toBe(shot); // a speck, not a product
    expect(await cropToProduct({ base64: 'QUJD', mimeType: 'image/jpeg' }, [10, 10, 60, 60])).toEqual({ base64: 'QUJD', mimeType: 'image/jpeg' });
  });

  it('compares the cropped photo, not the whole screenshot', async () => {
    const { matchCustomerPhoto } = await load();
    mockSearch.mockResolvedValue([product('GEMBOK KOTAK CHROME PANJANG', `${DIR}/a.png`)]);
    verdict({ match: null, certainty: 'none', reason: 'x' });

    await matchCustomerPhoto(await screenshot(), ['gembok'], '', { box: [25, 62.5, 50, 75], category: 'gembok' });

    const content = mockCreate.mock.calls[0]![0].messages[0].content as { type: string; source?: { data: string } }[];
    const shown = await sharp(Buffer.from(content.find((c) => c.type === 'image')!.source!.data, 'base64')).metadata();
    // The 1:2 screenshot would arrive 256x512; the product's square box arrives square.
    expect(shown.width).toBe(shown.height);
  });
});

// Live 2026-10-25 a black window rambuncis (we sell none) was "similar OVERVAL PLAT"; replayed with the
// photo cropped it was "similar" or even "same" DOOR STOP 4 times in 5 - our door stop is a lever on a
// round base too. The prompt, a same-type question and category labels all failed to stop it, while the
// vision step called the item "panolet / rambuncis" 5 times in 6. So a pick must share a word with that.
describe('a pick of a different type of item than the vision step saw', () => {
  const typed = (name: string, url: string, category: string, kataKunci: string) =>
    ({ ...(product(name, url) as object), category: { name: category }, kataKunci }) as never;
  const doorStop = () => typed('DOOR STOP VINTAGE', `${DIR}/a.png`, 'Door Stop', 'Penahan pintu\nStopper pintu\nDoor holder\nMagnetic door stop');
  const plateHandle = () => typed('HANDLE BESAR HITAM + BODY HITAM VINTAGE ALEXANDER', `${DIR}/a.png`, 'Door Handle Besar', 'Handle pintu besar\nLong plate door handle');

  it('is dropped when its catalog text shares no word with what the vision step called the item', async () => {
    const { matchCustomerPhoto } = await load();
    mockSearch.mockResolvedValue([doorStop()]);
    for (const certainty of ['similar', 'same']) {
      verdict({ match: 'A', certainty, reason: 'bentuk dasar bulat' });
      const m = await matchCustomerPhoto(customer, ['panolet'], '', { box: null, category: 'panolet / rambuncis jendela' });
      expect(m).toMatchObject({ certainty: 'none', product: null });
      expect(m!.reason).toContain('panolet / rambuncis jendela'); // the log says why
    }
  });

  it('does not count "pintu": nearly every product says it', async () => {
    const { matchCustomerPhoto } = await load();
    mockSearch.mockResolvedValue([doorStop()]);
    verdict({ match: 'A', certainty: 'similar', reason: 'x' });
    expect(await matchCustomerPhoto(customer, ['engsel'], '', { box: null, category: 'engsel pintu' })).toMatchObject({ certainty: 'none' });
  });

  it('stands when the item word is in the product name, category or kata kunci', async () => {
    const { matchCustomerPhoto } = await load();
    mockSearch.mockResolvedValue([plateHandle()]);
    verdict({ match: 'A', certainty: 'similar', reason: 'x' });
    expect(await matchCustomerPhoto(customer, ['handle'], '', { box: null, category: 'handle pintu' }))
      .toMatchObject({ certainty: 'similar', product: { name: 'HANDLE BESAR HITAM + BODY HITAM VINTAGE ALEXANDER' } });
    mockSearch.mockResolvedValue([doorStop()]);
    expect(await matchCustomerPhoto(customer, ['stopper'], '', { box: null, category: 'penahan pintu magnet' }))
      .toMatchObject({ certainty: 'similar', product: { name: 'DOOR STOP VINTAGE' } });
  });

  it('stands when the vision step named no item', async () => {
    const { matchCustomerPhoto } = await load();
    mockSearch.mockResolvedValue([doorStop()]);
    verdict({ match: 'A', certainty: 'similar', reason: 'x' });
    expect(await matchCustomerPhoto(customer, ['x'], '', { box: null, category: '' })).toMatchObject({ certainty: 'similar' });
    expect(await matchCustomerPhoto(customer, ['x'], '')).toMatchObject({ certainty: 'similar' });
  });
});

describe('the words the shortlist is searched with', () => {
  it('leaves out the placeholder an uncaptioned photo is stored with', async () => {
    // Live 2026-10-25: "pelanggan, mengirim, foto, analisis, gambar, terlampir" were searched as words.
    const { shortlistTerms } = await load();
    expect(shortlistTerms(['handle', 'hitam'], '[Pelanggan mengirim foto — analisis gambar terlampir]')).toEqual(['handle', 'hitam']);
  });
});

describe('the product box the vision step returns', () => {
  it('reads a box in percent, and drops a malformed one without losing the keywords', async () => {
    const { parseVisionExtract } = await import('../src/services/visionKeywords.js');
    const base = { confidence: 'high', primary_category: 'handle pintu' };
    expect(parseVisionExtract(JSON.stringify({ ...base, product_box: [10, 20, 60, 80] })).product_box).toEqual([10, 20, 60, 80]);
    for (const bad of [[60, 20, 10, 80], [10, 20, 160, 80], [10, 20, 60], 'kiri atas', null]) {
      const v = parseVisionExtract(JSON.stringify({ ...base, product_box: bad }));
      expect(v.product_box).toBeNull();
      expect(v.primary_category).toBe('handle pintu');
    }
  });

  // Replay 2026-10-27: a reply with no product_box key at all failed the whole parse, keywords included.
  it('reads an extract that has no product_box key at all', async () => {
    const { parseVisionExtract } = await import('../src/services/visionKeywords.js');
    const v = parseVisionExtract(JSON.stringify({ confidence: 'high', primary_category: 'grendel' }));
    expect(v.product_box).toBeNull();
    expect(v.primary_category).toBe('grendel');
  });
});

describe('which model compares, on the Claude Code route', () => {
  it('asks Sonnet, and falls back to the reply model when Sonnet is unavailable', async () => {
    const { matchCustomerPhoto } = await load();
    devMode = true;
    mockSearch.mockResolvedValue([product('GEMBOK KOTAK CHROME PANJANG', `${DIR}/a.png`)]);
    mockAgentQuery
      .mockRejectedValueOnce(new Error("You've hit your limit for Sonnet"))
      .mockResolvedValueOnce('{"match": "A", "certainty": "same", "reason": "x"}');

    const m = await matchCustomerPhoto(customer, ['gembok'], '');

    expect(mockAgentQuery.mock.calls.map((c) => c[0].model)).toEqual(['sonnet', undefined]);
    expect(m).toMatchObject({ certainty: 'same', product: { name: 'GEMBOK KOTAK CHROME PANJANG' } });
  });
});

describe('reading the verdict', () => {
  it('accepts a valid letter, in either case', async () => {
    const { parseVerdict } = await load();
    expect(parseVerdict('{"match": "A", "certainty": "same", "reason": "x"}', 3)).toEqual({ match: 1, certainty: 'same', reason: 'x' });
    expect(parseVerdict('```json\n{"match": " b ", "certainty": "similar"}\n```', 3)).toMatchObject({ match: 2, certainty: 'similar' });
  });

  // A number is how the old labels were miscounted against the customer's own photo.
  it('turns a verdict that names no valid photo into "none" - a number included', async () => {
    const { parseVerdict } = await load();
    expect(parseVerdict('{"match": "D", "certainty": "same"}', 3)).toMatchObject({ match: null, certainty: 'none' });
    expect(parseVerdict('{"match": 2, "certainty": "same"}', 3)).toMatchObject({ match: null, certainty: 'none' });
    expect(parseVerdict('{"match": null, "certainty": "similar"}', 3)).toMatchObject({ certainty: 'none' });
    expect(parseVerdict('tidak tahu', 3)).toBeNull();
  });
});

describe('the note the reply model reads', () => {
  const base = { compared: ['A', 'B'], reason: '' };
  it('same: confirm with confidence', async () => {
    const { photoMatchNote } = await load();
    expect(photoMatchNote({ ...base, certainty: 'same', product: { name: 'A', brand: null, imageUrl: '/a.jpg' } })).toMatch(/SAMA dengan foto produk kami A\. Konfirmasikan/);
  });
  it('similar: ask, and send our photo along', async () => {
    const { photoMatchNote } = await load();
    const n = photoMatchNote({ ...base, certainty: 'similar', product: { name: 'A', brand: null, imageUrl: '/a.jpg' } })!;
    expect(n).toMatch(/MIRIP/);
    expect(n).toMatch(/Tanyakan ke pelanggan apakah yang dimaksud A/);
    expect(n).toContain('image_url dengan /a.jpg');
  });
  // Live 2026-10-14: an earlier photo's verdict, replayed in the history, beat this one unscoped.
  it('every verdict says it is for the latest photo, not one earlier in the chat', async () => {
    const { photoMatchNote } = await load();
    const p = { name: 'A', brand: null, imageUrl: '/a.jpg' };
    for (const certainty of ['same', 'similar', 'none'] as const) {
      expect(photoMatchNote({ ...base, certainty, product: certainty === 'none' ? null : p })).toMatch(/pesan TERAKHIR pelanggan; foto lain di riwayat/);
    }
  });
  it('none: scoped to the photos compared, not "we do not sell it"', async () => {
    const { photoMatchNote } = await load();
    const n = photoMatchNote({ ...base, certainty: 'none', product: null })!;
    expect(n).toMatch(/dibandingkan dengan foto produk A, B dan TIDAK ada yang sama/);
    expect(n).toMatch(/Produk lain belum punya foto pembanding/);
    expect(photoMatchNote(null)).toBeNull();
  });
});

describe('the note for photos sent together', () => {
  const p = (name: string) => ({ compared: [name], reason: '', certainty: 'same' as const, product: { name, brand: null, imageUrl: `/${name}.jpg` } });
  it('numbers each verdict by its photo, and scopes them once to the latest message', async () => {
    const { photoBatchNote } = await load();
    const n = photoBatchNote([{ match: p('A'), brands: [] }, { match: null, brands: ['AIGO'] }, { match: p('C'), brands: [] }])!;
    expect(n).toMatch(/FOTO 1: PERBANDINGAN FOTO: [^]*produk kami A\.[^]*FOTO 2: [^]*AIGO[^]*FOTO 3: [^]*produk kami C\./);
    expect(n.match(/pesan TERAKHIR/g)).toHaveLength(1);
  });
  it('is the single-photo note for one photo, and nothing when no photo has a note', async () => {
    const { photoBatchNote, photoTurnNote } = await load();
    expect(photoBatchNote([{ match: p('A'), brands: [] }])).toBe(photoTurnNote(p('A'), []));
    expect(photoBatchNote([{ match: null, brands: [] }, { match: null, brands: [] }])).toBeNull();
  });
});

describe('what a later turn knows about the photo', () => {
  it('the verdict when there is one, else what the photo showed', async () => {
    const { photoHistoryNote } = await load();
    const p = { name: 'HANDLE PISAH STAINLESS STEEL + BODY 1231 VINTAGE SATURNUS', brand: 'Vintage', imageUrl: '/x.jpg' };
    expect(photoHistoryNote({ certainty: 'same', product: p, compared: [p.name], reason: '' }, ['handle'])).toBe(`produk kami ${p.name} (foto sama)`);
    // Since 2026-11-11 an unconfirmed photo went to the team, so a later turn offers nothing on its strength
    // either - neither a product (the "mirip" candidate) nor a denial (review 2026-10-13: an unnamed
    // "mirip" read as "not carried"). The customer's own words still decide.
    const similar = photoHistoryNote({ certainty: 'similar', product: p, compared: [p.name], reason: '' }, []);
    expect(similar).toMatch(/belum bisa dipastikan produk kami - tim sedang mengecek/);
    expect(similar).toMatch(/jangan menawarkan, menyebut, atau menolak produk/);
    expect(similar).toContain(`mirip ${p.name}, belum pasti`);
    const none = photoHistoryNote({ certainty: 'none', product: null, compared: [p.name], reason: '' }, ['engsel', 'pintu']);
    expect(none).toMatch(/^belum bisa dipastikan produk kami[^]*; isi foto: engsel, pintu$/);
    expect(photoHistoryNote(null, ['engsel', 'pintu'])).toMatch(/^belum bisa dipastikan produk kami[^]*; isi foto: engsel, pintu$/);
  });
});

// Live 2026-10-22: a SOLID padlock pack was answered "gembok 60mm solid yang kokoh" - the brand read
// as the adjective, and never said to be one we do not carry.
describe('a brand printed on the photo that is not ours', () => {
  it('otherBrands keeps foreign brands and drops ours, however they are spelled', async () => {
    const { otherBrands } = await import('../src/services/visionKeywords.js');
    expect(otherBrands({ brand_names: ['SOLID'] })).toEqual(['SOLID']);
    expect(otherBrands({ brand_names: ['BLOSSOM', 'dxplore', 'Aomori Slim', 'LEGACY'] })).toEqual([]);
    expect(otherBrands({ brand_names: ['SOLID', 'Solid', ' '] })).toEqual(['SOLID']);
    expect(otherBrands({ brand_names: undefined as never })).toEqual([]);
  });
  it('the reply is told it is a brand we do not carry, after the comparison verdict', async () => {
    const { photoTurnNote, photoBrandNote } = await load();
    const n = photoBrandNote(['SOLID'])!;
    expect(n).toMatch(/merek SOLID - itu NAMA MEREK lain, bukan merek kami, dan bukan sifat barangnya/);
    expect(n).toMatch(/BARANG YANG TIDAK KAMI PUNYA/);
    expect(photoBrandNote([])).toBeNull();
    const both = photoTurnNote({ compared: ['A'], reason: '', certainty: 'none', product: null }, ['SOLID'])!;
    expect(both.indexOf('PERBANDINGAN FOTO')).toBeLessThan(both.indexOf('MEREK DI FOTO'));
    expect(photoTurnNote(null, [])).toBeNull();
  });
  it('a later turn still knows the brand', async () => {
    const { photoHistoryNote } = await load();
    expect(photoHistoryNote(null, ['gembok', 'silver'], ['SOLID'])).toMatch(/^merek SOLID \(bukan merek kami\); belum bisa dipastikan produk kami[^]*; isi foto: gembok, silver$/);
    const p = { name: 'GEMBOK BESI JACKET', brand: 'Blossom', imageUrl: '/j.jpg' };
    expect(photoHistoryNote({ certainty: 'same', product: p, compared: [p.name], reason: '' }, [], ['SOLID'])).toBe('merek SOLID (bukan merek kami); produk kami GEMBOK BESI JACKET (foto sama)');
  });
});
