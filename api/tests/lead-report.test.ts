/**
 * lead-report.test.ts - the numbers behind the daily "Ringkasan" page. Fixtures sit in March 2020
 * so the (production-restored) local DB contributes nothing to the range. Needs DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import 'dotenv/config';
import Fastify from 'fastify';
import { sql } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { contacts, leads, phoneNumbers, conversations, messages } from '../src/db/schema.js';

vi.mock('../src/middleware/apiKey.js', () => ({ apiKeyAuth: async () => {} }));

const { getLeadReport } = await import('../src/repositories/leadReport.js');
const { leadRoutes } = await import('../src/routes/dashboard/leads.js');

const P = '__leadreport_test__';
const wib = (s: string) => new Date(`${s}+07:00`);
const RANGE = { startDate: '2020-03-01', endDate: '2020-03-14' };
// Unreplied only shows waits of the last 7 days, so those fixtures sit relative to now.
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

describe('getLeadReport', () => {
  const ids: Record<string, string> = {};
  let phoneId: string;

  async function cleanup() {
    const db = getDb();
    const mine = sql`(SELECT id FROM contacts WHERE wa_id LIKE ${`${P}%`})`;
    await db.execute(sql`DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE contact_id IN ${mine})`);
    await db.execute(sql`DELETE FROM conversations WHERE contact_id IN ${mine}`);
    await db.execute(sql`DELETE FROM lead_events WHERE lead_id IN (SELECT id FROM leads WHERE contact_id IN ${mine})`);
    await db.execute(sql`UPDATE leads SET previous_lead_id = NULL WHERE contact_id IN ${mine}`);
    await db.execute(sql`DELETE FROM leads WHERE contact_id IN ${mine}`);
    await db.execute(sql`DELETE FROM contacts WHERE wa_id LIKE ${`${P}%`}`);
    await db.execute(sql`DELETE FROM phone_numbers WHERE number = ${`${P}n`}`);
  }

  async function mk(
    key: string,
    lead: Partial<typeof leads.$inferInsert>,
    msgs: { role: 'user' | 'assistant'; at: string | Date; body?: string }[] = []
  ) {
    const db = getDb();
    const [c] = await db.insert(contacts).values({ waId: `${P}${key}`, displayName: `Name ${key}` }).returning();
    const [l] = await db.insert(leads).values({
      contactId: c!.id,
      // Own campaign bucket: leads.test.ts counts the unfiltered "Organik" bucket in parallel.
      utmCampaign: P,
      ...lead,
    }).returning();
    ids[key] = l!.id;
    if (msgs.length) {
      const [cv] = await db.insert(conversations).values({ contactId: c!.id, phoneNumberId: phoneId }).returning();
      for (const m of msgs) {
        await db.insert(messages).values({
          conversationId: cv!.id, role: m.role, body: m.body ?? `${key} ${m.role}`,
          createdAt: typeof m.at === 'string' ? wib(m.at) : m.at,
        });
      }
    }
  }

  beforeAll(async () => {
    await cleanup();
    const db = getDb();
    const [ph] = await db.insert(phoneNumbers).values({ number: `${P}n`, wabaId: 't', phoneNumberId: 't' }).returning();
    phoneId = ph!.id;

    // Old lead the returning one points at: closed before the range.
    await mk('E', { status: 'won', submittedAt: wib('2020-02-01T10:00:00'), closedAt: wib('2020-02-05T10:00:00') });
    // A: won, closed 23:30 WIB on 3 Mar. Customer wrote twice on 2 Mar and once just after midnight on 4 Mar.
    await mk('A', { status: 'won', submittedAt: wib('2020-03-02T10:00:00'), firstContactAt: wib('2020-03-02T12:00:00'), closedAt: wib('2020-03-03T23:30:00') },
      [{ role: 'user', at: '2020-03-02T11:00:00' }, { role: 'user', at: '2020-03-02T15:00:00' }, { role: 'user', at: '2020-03-04T00:10:00' }]);
    // B: won, closed 00:30 WIB on 4 Mar.
    await mk('B', { status: 'won', submittedAt: wib('2020-03-03T09:00:00'), firstContactAt: wib('2020-03-03T00:30:00'), closedAt: wib('2020-03-04T00:30:00') },
      [{ role: 'user', at: '2020-03-03T09:00:00' }, { role: 'assistant', at: '2020-03-03T09:05:00' }]);
    // C: lost for price; only the bot wrote, so not "contacted".
    await mk('C', { status: 'lost', lostReason: 'harga', submittedAt: wib('2020-03-06T10:00:00'), closedAt: wib('2020-03-07T10:00:00') },
      [{ role: 'assistant', at: '2020-03-06T10:05:00' }]);
    // D: returning lead, open. 01:00 WIB on 9 Mar is still 8 Mar in UTC.
    await mk('D', { status: 'new', previousLeadId: ids.E!, submittedAt: wib('2020-03-08T10:00:00') },
      [{ role: 'user', at: '2020-03-09T01:00:00' }]);
    // F: a courier that was "won" - counted nowhere.
    await mk('F', { kind: 'kurir', status: 'won', submittedAt: wib('2020-03-09T10:00:00'), closedAt: wib('2020-03-09T12:00:00') },
      [{ role: 'user', at: '2020-03-09T10:30:00' }]);
    // G: started last month, won in range: a win, not a new lead.
    await mk('G', { status: 'won', submittedAt: wib('2020-02-10T10:00:00'), firstContactAt: wib('2020-03-08T10:00:00'), closedAt: wib('2020-03-10T10:00:00') });
    // H: first_contact NULL (imported then claimed): time to close starts at matched_at.
    await mk('H', { status: 'won', submittedAt: wib('2020-03-11T08:00:00'), matchedAt: wib('2020-03-11T00:00:00'), closedAt: wib('2020-03-12T00:00:00') });
    // I: lost with no reason.
    await mk('I', { status: 'lost', submittedAt: wib('2020-03-13T10:00:00'), closedAt: wib('2020-03-13T11:00:00') });
    // R: a renewed customer - old Lost lead + new lead, customer waiting on one shared chat.
    await mk('Rold', { status: 'lost', submittedAt: wib('2020-01-20T10:00:00') },
      [{ role: 'user', at: daysAgo(1), body: 'balik lagi' }]);
    await db.insert(leads).values({
      contactId: (await db.select().from(leads).where(sql`id = ${ids.Rold}`))[0]!.contactId!,
      utmCampaign: P, previousLeadId: ids.Rold!, submittedAt: wib('2020-01-21T10:00:00'),
    }).returning().then(([l]) => { ids.Rnew = l!.id; });
    // Unreplied: U1 customer spoke last (2 days ago), U10 too but 10 days ago (past the window),
    // U2 bot answered last, K is a courier waiting.
    await mk('U1', { status: 'contacted', submittedAt: wib('2020-01-10T10:00:00') },
      [{ role: 'user', at: daysAgo(2), body: 'masih ada stok?' }]);
    await mk('U10', { status: 'contacted', submittedAt: wib('2020-01-10T10:00:00') },
      [{ role: 'user', at: daysAgo(10) }]);
    await mk('U2', { status: 'contacted', submittedAt: wib('2020-01-11T10:00:00') },
      [{ role: 'user', at: daysAgo(3) }, { role: 'assistant', at: daysAgo(2.9) }]);
    await mk('K', { kind: 'kurir', submittedAt: wib('2020-01-12T10:00:00') },
      [{ role: 'user', at: daysAgo(2) }]);
  });

  afterAll(async () => {
    await cleanup();
  });

  it('counts new, returning, won, lost per the definitions and ignores non-lead kinds', async () => {
    const r = await getLeadReport(RANGE);
    expect(r.newLeads).toBe(6);        // A B C D H I - not E/G (other months), not F (kurir)
    expect(r.returningLeads).toBe(1);  // D
    expect(r.won).toBe(4);             // A B G H - G started last month but counts here
    expect(r.lost).toBe(2);            // C I
    expect(r.contactedLeads).toBe(3);  // A B D
  });

  it('conversion is won-now of the range new leads, one decimal', async () => {
    const r = await getLeadReport(RANGE);
    expect(r.conversionPct).toBe(50.0); // A B H of A B C D H I
  });

  it('avgDaysToClose averages closed_at - coalesce(first_contact, matched, submitted) over wins in range', async () => {
    const r = await getLeadReport(RANGE);
    // A 1.479, B 1.0, G 2.0, H 1.0 -> 1.37
    expect(r.avgDaysToClose).toBe(1.4);
  });

  it('daily covers every WIB day with zeros and buckets by WIB, not UTC', async () => {
    const r = await getLeadReport(RANGE);
    expect(r.daily).toHaveLength(14);
    expect(r.daily[0]!.day).toBe('2020-03-01');
    expect(r.daily[13]!.day).toBe('2020-03-14');
    const d = (day: string) => r.daily.find((x) => x.day === day)!;
    expect(d('2020-03-01')).toEqual({ day: '2020-03-01', newLeads: 0, contacted: 0 });
    expect(d('2020-03-02')).toMatchObject({ newLeads: 1, contacted: 1 }); // A, two messages = one lead
    expect(d('2020-03-04')).toMatchObject({ newLeads: 0, contacted: 1 }); // A again at 00:10 WIB
    expect(d('2020-03-09')).toMatchObject({ contacted: 1 });              // D at 01:00 WIB (8 Mar UTC); F is a courier
    expect(d('2020-03-08')).toMatchObject({ newLeads: 1, contacted: 0 });
  });

  it('closing is bucketed by WIB day: 23:30 WIB counts for the 3rd, 00:30 WIB for the 4th', async () => {
    const third = await getLeadReport({ startDate: '2020-03-03', endDate: '2020-03-03' });
    const fourth = await getLeadReport({ startDate: '2020-03-04', endDate: '2020-03-04' });
    expect(third.won).toBe(1);   // A only
    expect(fourth.won).toBe(1);  // B only
  });

  it('funnel has all five statuses for the range new leads', async () => {
    const r = await getLeadReport(RANGE);
    expect(r.funnel).toEqual({ new: 1, contacted: 0, quoted: 0, won: 3, lost: 2 });
  });

  it('lostReasons groups the lost leads in range, null reason included', async () => {
    const r = await getLeadReport(RANGE);
    expect(r.lostReasons).toEqual([{ reason: 'harga', count: 1 }, { reason: null, count: 1 }]);
  });

  it('unreplied ignores the range: lists recent waits whose newest message is the customer, oldest first', async () => {
    const r = await getLeadReport(RANGE);
    const byId = (k: string) => r.unreplied.findIndex((u) => u.leadId === ids[k]);
    expect(byId('U1')).toBeGreaterThanOrEqual(0);
    expect(byId('U10')).toBe(-1);  // waiting 10 days: past UNREPLIED_MAX_AGE_DAYS
    expect(byId('A')).toBe(-1);    // waiting since 2020
    expect(byId('U2')).toBe(-1);   // the bot answered last
    expect(byId('K')).toBe(-1);    // not a lead
    expect(byId('C')).toBe(-1);    // only the bot wrote
    expect(byId('U1')).toBeLessThan(byId('Rnew'));
    const u1 = r.unreplied[byId('U1')]!;
    expect(u1).toMatchObject({ name: 'Name U1', waId: `${P}U1`, status: 'contacted', lastMessage: 'masih ada stok?' });
    expect(Date.now() - new Date(u1.waitingSince).getTime()).toBeGreaterThan(1.9 * 86_400_000);
    expect(r.unreplied.length).toBeLessThanOrEqual(50);
    // A renewed customer is listed once, as the renewed lead.
    expect(byId('Rold')).toBe(-1);
    expect(r.unreplied.filter((u) => u.leadId === ids.Rnew)).toHaveLength(1);
  });

  it('a range with nothing in it is all zeros with null ratios', async () => {
    const r = await getLeadReport({ startDate: '2019-01-01', endDate: '2019-01-03' });
    expect(r).toMatchObject({ newLeads: 0, won: 0, lost: 0, contactedLeads: 0, conversionPct: null, avgDaysToClose: null });
    expect(r.daily.map((x) => x.day)).toEqual(['2019-01-01', '2019-01-02', '2019-01-03']);
    expect(r.funnel).toEqual({ new: 0, contacted: 0, quoted: 0, won: 0, lost: 0 });
  });

  it('defaults to the last 14 WIB days ending today', async () => {
    const r = await getLeadReport({});
    expect(r.daily).toHaveLength(14);
    const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    expect(r.daily[13]!.day).toBe(today);
  });
});

describe('GET /api/v1/leads/report', () => {
  const app = Fastify();
  beforeAll(async () => { await app.register(leadRoutes); });
  afterAll(async () => { await app.close(); });

  it('returns the report in the envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/leads/report?startDate=2019-01-01&endDate=2019-01-02' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.error).toBeNull();
    expect(body.data.daily).toHaveLength(2);
  });

  it('rejects a malformed date and an end before the start', async () => {
    for (const q of [
      'startDate=03-01-2020',
      'startDate=2020-02-30',
      'startDate=2020-03-05&endDate=2020-03-04',
      'startDate=2999-01-01',                       // future start, no end
      'startDate=0001-01-01&endDate=0001-01-02',    // before 2000
      'startDate=1999-12-31&endDate=2000-01-02',
      'startDate=2020-01-01&endDate=2021-01-02',    // 367 days apart
    ]) {
      const res = await app.inject({ method: 'GET', url: `/api/v1/leads/report?${q}` });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ data: null, error: 'VALIDATION_ERROR' });
    }
  });
});
