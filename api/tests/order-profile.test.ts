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
    expect(mergeOrderFacts({}, { brands: ['legacy'] }).brands).toEqual([]));
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
