import { describe, it, expect, afterAll } from 'vitest';
import 'dotenv/config';
import { like } from 'drizzle-orm';
import { mergeOrderFacts, orderDetailsSummary, itemKey, type OrderItem } from '../src/domain/orderProfile.js';
import { normalizeSize } from '../src/services/priceTool.js';
import { getDb } from '../src/db/client.js';
import { contacts } from '../src/db/schema.js';
import { upsertContactProfile, getContactProfile } from '../src/repositories/contactProfiles.js';

const SUPREME_30: OrderItem = { product: 'Kertas Supreme 64 gsm', size: '30x30', print: '1 warna', qty: 5, qty_unit: 'rim', has_design: false };
const BOX_20: OrderItem = { product: 'Box Nasi', size: '20x20x7,5', qty: 1000, qty_unit: 'pcs' };

describe('mergeOrderFacts', () => {
  it('unions brands', () =>
    expect(mergeOrderFacts({ brands: ['kertas_supreme'] }, { brands: ['imperial_indopack'] }).brands).toEqual(['kertas_supreme', 'imperial_indopack']));
  it('does not duplicate a brand', () =>
    expect(mergeOrderFacts({ brands: ['kertas_supreme'] }, { brands: ['kertas_supreme'] }).brands).toEqual(['kertas_supreme']));
  it('keeps brands when the patch sends none', () =>
    expect(mergeOrderFacts({ brands: ['kertas_supreme'] }, { name: 'A' }).brands).toEqual(['kertas_supreme']));
  it('appends a new item and keeps the old one (paper → boxes)', () =>
    expect(mergeOrderFacts({ items: [SUPREME_30] }, { items: [BOX_20] }).items as OrderItem[]).toHaveLength(2));
  it('updates only the sent fields of a known item, size spelled differently', () =>
    expect(mergeOrderFacts({ items: [{ product: 'Kertas Supreme 64 gsm', size: '30x30', qty: 5, qty_unit: 'rim' }] },
      { items: [{ product: 'kertas supreme 64 gsm', size: '30 x 30 cm', qty: 10 }] }).items)
      .toEqual([{ product: 'Kertas Supreme 64 gsm', size: '30x30', qty: 10, qty_unit: 'rim' }]));
  it('plain keys overwrite and others stay', () => {
    const r = mergeOrderFacts({ name: 'A', business_name: 'X' }, { name: 'B' });
    expect(r).toEqual({ name: 'B', business_name: 'X' });
  });
  it('ignores a brand that is not a known slug', () =>
    expect(mergeOrderFacts({}, { brands: ['brand_lain'] }).brands).toEqual([]));
  it('does not mutate its inputs', () => {
    const existing = { items: [{ ...SUPREME_30 }] };
    mergeOrderFacts(existing, { items: [{ product: 'Kertas Supreme 64 gsm', size: '30x30', qty: 99 }] });
    expect(existing.items[0]!.qty).toBe(5);
  });
  it('itemKey and normalizeSize agree across spellings', () => {
    expect(itemKey({ product: 'A', size: '30×30' })).toBe(itemKey({ product: 'a', size: '30 X 30 cm' }));
    expect(normalizeSize('30*30')).toBe('30x30');
  });
});

describe('mergeOrderFacts item validation', () => {
  const items = (patch: Record<string, unknown>[]) => mergeOrderFacts({}, { items: patch }).items as OrderItem[];
  it('coerces numeric product/size/gsm to strings', () =>
    expect(items([{ product: 5, size: 30, gsm: 64 }])).toEqual([{ product: '5', size: '30', gsm: '64' }]));
  it('drops object values', () =>
    expect(items([{ product: 'Box', size: { a: 1 }, gsm: [1], print: {} }])).toEqual([{ product: 'Box' }]));
  it('parses qty strings and drops bad qty / qty_unit', () => {
    expect(items([{ product: 'A', qty: '10' }])[0]!.qty).toBe(10);
    expect(items([{ product: 'A', qty: '2.500' }])[0]!.qty).toBe(2500);
    expect(items([{ product: 'A', qty: {} }])[0]).toEqual({ product: 'A' });
    expect(items([{ product: 'A', qty: 5, qty_unit: 'box' }])[0]).toEqual({ product: 'A', qty: 5 });
    expect(items([{ product: 'A', qty_unit: 'Lembar', has_design: 'ya' }])[0]).toEqual({ product: 'A', qty_unit: 'pcs' });
  });
  it('drops an item with no product and no size', () =>
    expect(items([{ qty: 3 }, { product: 'A' }])).toEqual([{ product: 'A' }]));
  it('sanitises already-stored items when merging', () =>
    expect(mergeOrderFacts({ items: [{ product: 5, qty: {} }] }, { items: [{ product: '5', qty: 2 }] }).items)
      .toEqual([{ product: '5', qty: 2 }]));
});

// Final review C1: "logo saya sudah ada kak" is a design fact with no product or size yet. Dropped, the
// hand-off asked "apakah sudah ada desain atau logo...?" right after it.
describe('a design-only fact', () => {
  it('keeps a design-only item as the order-level has_design instead of dropping it', () =>
    expect(mergeOrderFacts({}, { items: [{ has_design: true }] })).toEqual({ items: [], has_design: true }));
  it('keeps the other items, and a later answer overwrites it', () => {
    const once = mergeOrderFacts({ items: [BOX_20] }, { items: [{ has_design: false }, SUPREME_30] });
    expect(once.items).toHaveLength(2);
    expect(once.has_design).toBe(false);
    expect(mergeOrderFacts(once, { has_design: true }).has_design).toBe(true);
  });
  it('ignores a design-only item whose has_design is not a boolean', () =>
    expect(mergeOrderFacts({}, { items: [{ has_design: 'ya' }] })).toEqual({ items: [] }));
  it('shows the order-level design to staff', () => {
    expect(orderDetailsSummary({ has_design: true, items: [BOX_20] })).toContain('Desain: ada');
    expect(orderDetailsSummary({ has_design: false })).toBe('Desain: belum ada');
  });
});

describe('orderDetailsSummary', () => {
  it('summarises the details for staff', () =>
    expect(orderDetailsSummary({ name: 'Budi', business_name: 'RM Siang', items: [SUPREME_30] })).toBe(
      'Nama: Budi\nUsaha: RM Siang\nBarang: Kertas Supreme 64 gsm cetak 1 warna, 30x30, 5 rim, desain: belum ada'));
  it('says "ada" when the customer has a design', () =>
    expect(orderDetailsSummary({ items: [{ ...SUPREME_30, has_design: true }] })).toContain('desain: ada'));
  it('omits unknown parts cleanly', () => {
    expect(orderDetailsSummary({ items: [{ product: 'Box Nasi', qty: 3 }] })).toBe('Barang: Box Nasi, 3');
    expect(orderDetailsSummary({})).toBe('');
  });
  it('prints no empty "Barang:" line for a stored item that sanitises to nothing', () => {
    expect(orderDetailsSummary({ items: [{ product: '  ', qty: {} }, {}, { product: 'Box Nasi' }] })).toBe('Barang: Box Nasi');
    expect(orderDetailsSummary({ items: [{ product: '', size: null }] })).toBe('');
  });
  it('does not throw on legacy stored items', () =>
    expect(orderDetailsSummary({ items: [{ gsm: 64, qty: {} }, { product: 7, size: 30 }] })).toBe('Barang: 64 gsm\nBarang: 7, 30'));
  it('orderDetailsSummary writes 300 gsm once whatever the stored spelling', () => {
    for (const gsm of ['300', '300gsm', '300 gsm', '300 GSM', 300]) {
      expect(orderDetailsSummary({ items: [{ product: 'Box Contoh', gsm, size: '20x20x7' }] })).toBe('Barang: Box Contoh 300 gsm, 20x20x7');
    }
    // The product name already says it, in any spelling.
    expect(orderDetailsSummary({ items: [{ product: 'Box Makan Ivory 300 gsm', gsm: '300', size: '20x20x7' }] })).toBe('Barang: Box Makan Ivory 300 gsm, 20x20x7');
    expect(orderDetailsSummary({ items: [{ product: 'Box Makan Ivory 300gsm', gsm: '300 gsm' }] })).toBe('Barang: Box Makan Ivory 300gsm');
  });
  it('lists several items on their own lines', () =>
    expect(orderDetailsSummary({ items: [SUPREME_30, BOX_20] }).split('\n')).toHaveLength(2));
});

describe('upsertContactProfile accumulates items', () => {
  const PREFIX = '__order_profile_test__';
  afterAll(async () => { await getDb().delete(contacts).where(like(contacts.waId, `${PREFIX}%`)); });

  it('two upserts with different items keep both, also when concurrent', async () => {
    const db = getDb();
    const [c] = await db.insert(contacts).values({ waId: `${PREFIX}wa`, displayName: `${PREFIX}n` }).returning({ id: contacts.id });
    await upsertContactProfile(c!.id, { profilePatch: { items: [SUPREME_30], brands: ['kertas_supreme'] } });
    await upsertContactProfile(c!.id, { profilePatch: { items: [BOX_20], brands: ['imperial_indopack'] } });
    const p = await getContactProfile(c!.id);
    expect(p?.profile.items as OrderItem[]).toHaveLength(2);
    expect(p?.profile.brands).toEqual(['kertas_supreme', 'imperial_indopack']);

    const [d] = await db.insert(contacts).values({ waId: `${PREFIX}wb`, displayName: `${PREFIX}n2` }).returning({ id: contacts.id });
    await Promise.all([
      upsertContactProfile(d!.id, { profilePatch: { items: [SUPREME_30] } }),
      upsertContactProfile(d!.id, { profilePatch: { items: [BOX_20] } }),
    ]);
    expect((await getContactProfile(d!.id))?.profile.items as OrderItem[]).toHaveLength(2);
  });
});
