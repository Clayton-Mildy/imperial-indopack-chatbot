/** Per-brand lead performance, the report's brand filter and lead search. Fixtures in 2020 - needs DATABASE_URL. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import Fastify from 'fastify';
import { vi } from 'vitest';
import { getDb } from '../src/db/client.js';
import { contacts, leads } from '../src/db/schema.js';

vi.mock('../src/middleware/apiKey.js', () => ({ apiKeyAuth: async () => {} }));
const { leadRoutes } = await import('../src/routes/dashboard/leads.js');
const { getBrandSummary, listLeads } = await import('../src/repositories/leads.js');
const { getLeadReport } = await import('../src/repositories/leadReport.js');

const P = '__brandrep_test__';
const wib = (s: string) => new Date(`${s}+07:00`);
const RANGE = { startDate: '2020-05-01', endDate: '2020-05-07' };

async function cleanup() {
  const db = getDb();
  const mine = sql`(SELECT id FROM contacts WHERE wa_id LIKE ${`${P}%`})`;
  await db.execute(sql`DELETE FROM lead_events WHERE lead_id IN (SELECT id FROM leads WHERE contact_id IN ${mine})`);
  await db.execute(sql`DELETE FROM leads WHERE contact_id IN ${mine}`);
  await db.execute(sql`DELETE FROM contact_profiles WHERE contact_id IN ${mine}`);
  await db.execute(sql`DELETE FROM contacts WHERE wa_id LIKE ${`${P}%`}`);
}

async function mk(key: string, lead: Partial<typeof leads.$inferInsert>, profile?: Record<string, string>) {
  const db = getDb();
  const [c] = await db.insert(contacts).values({ waId: `${P}${key}`, displayName: `Contoh ${key}` }).returning();
  if (profile) await db.execute(sql`INSERT INTO contact_profiles (contact_id, profile) VALUES (${c!.id}, ${JSON.stringify(profile)}::jsonb)`);
  await db.insert(leads).values({ contactId: c!.id, utmCampaign: P, ...lead });
}

describe('brand summary, report brand filter, search', () => {
  beforeAll(async () => {
    await cleanup();
    await mk('KS', { brands: ['kertas_supreme'], status: 'won', submittedAt: wib('2020-05-02T10:00:00'), closedAt: wib('2020-05-03T10:00:00'),
      items: [{ product: 'Kertas Supreme 64 gsm', size: '35x35', qty: 5, qty_unit: 'rim' }] }, { business_name: 'Contoh Minang Rasa' });
    await mk('SP', { brands: ['kertas_supreme'], submittedAt: wib('2020-05-05T10:00:00'),
      items: [{ product: 'Box Contoh', size: '40 x 40', qty: 1 }] });
    await mk('II', { brands: ['imperial_indopack'], status: 'lost', lostReason: 'di_bawah_minimum', submittedAt: wib('2020-05-02T23:30:00'), closedAt: wib('2020-05-04T10:00:00') });
    await mk('BOTH', { brands: ['kertas_supreme', 'imperial_indopack'], status: 'new', submittedAt: wib('2020-05-04T08:00:00') });
  });
  afterAll(cleanup);

  it('counts a two-brand lead under both brands', async () => {
    const s = await getBrandSummary(RANGE);
    expect(s.map((b) => b.brand)).toEqual(['kertas_supreme', 'imperial_indopack']);
    expect(s[0]).toMatchObject({ leads: 3, chats: 3, won: 1, lost: 0, winPct: 33 });
    expect(s[1]).toMatchObject({ leads: 2, won: 0, lost: 1, winPct: 0 });
    const none = await getBrandSummary({ startDate: '2020-06-01', endDate: '2020-06-02' });
    expect(none.every((b) => b.leads === 0 && b.winPct === null)).toBe(true);
  });

  it('report filters by brand and buckets new leads per brand per day', async () => {
    const all = await getLeadReport(RANGE);
    expect(all.newLeads).toBe(4);
    expect(all.dailyByBrand).toHaveLength(7);
    // 23:30 WIB on 2 May is still 2 May in WIB.
    expect(all.dailyByBrand[1]).toEqual({ day: '2020-05-02', kertas_supreme: 1, imperial_indopack: 1 });
    expect(all.dailyByBrand[3]).toEqual({ day: '2020-05-04', kertas_supreme: 1, imperial_indopack: 1 });
    const ii = await getLeadReport({ ...RANGE, brand: 'imperial_indopack' });
    expect(ii.newLeads).toBe(2);
    expect(ii.lost).toBe(1);
    expect(ii.won).toBe(0);
    expect(ii.lostReasons).toEqual([{ reason: 'di_bawah_minimum', count: 1 }]);
    expect(ii.dailyByBrand[1]).toEqual({ day: '2020-05-02', kertas_supreme: 0, imperial_indopack: 1 });
    const ks = await getLeadReport({ ...RANGE, brand: 'kertas_supreme' });
    expect(ks.newLeads).toBe(3);
    expect(ks.won).toBe(1);
  });

  it('search finds an item size and a business name', async () => {
    const bySize = await listLeads({ page: 1, limit: 20, search: '35x35', campaign: P });
    expect(bySize.items.map((l) => l.waId)).toEqual([`${P}KS`]);
    // Spacing in the size does not matter, either way round.
    expect((await listLeads({ page: 1, limit: 20, search: '40x40', campaign: P })).items.map((l) => l.waId)).toEqual([`${P}SP`]);
    expect((await listLeads({ page: 1, limit: 20, search: '35 x 35', campaign: P })).items.map((l) => l.waId)).toEqual([`${P}KS`]);
    const byBiz = await listLeads({ page: 1, limit: 20, search: 'Contoh Minang', campaign: P });
    expect(byBiz.items.map((l) => l.waId)).toEqual([`${P}KS`]);
  });

  it('takes % _ and \\ in the search literally', async () => {
    for (const q of ['%', 'Contoh_', '\\']) {
      expect((await listLeads({ page: 1, limit: 20, search: q, campaign: P })).items).toHaveLength(0);
    }
  });

  it('serves the brand summary and the report brand filter over HTTP, and rejects bad dates', async () => {
    const app = Fastify();
    await app.register(leadRoutes);
    const ok = await app.inject({ method: 'GET', url: '/api/v1/leads/brand-summary?startDate=2020-05-01&endDate=2020-05-07' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data[1]).toMatchObject({ brand: 'imperial_indopack', leads: 2, lost: 1 });
    expect((await app.inject({ method: 'GET', url: '/api/v1/leads/brand-summary?startDate=nope' })).statusCode).toBe(400);
    const rep = await app.inject({ method: 'GET', url: '/api/v1/leads/report?startDate=2020-05-01&endDate=2020-05-07&brand=imperial_indopack' });
    expect(rep.json().data.newLeads).toBe(2);
    expect((await app.inject({ method: 'GET', url: '/api/v1/leads/report?brand=bogus' })).statusCode).toBe(400);
    await app.close();
  });
});
