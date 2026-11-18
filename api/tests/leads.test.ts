/**
 * leads.test.ts
 *
 * Two things worth guarding, and nothing else:
 *
 *  1. The parser, against the templates production actually sends. The samples below are
 *     copied from the prod dump, including the one where the customer's own greeting is
 *     merged in front of the template.
 *  2. Order-independence and claim-once. The Excel import and the WhatsApp match write the
 *     same row from two directions; whichever lands second must not undo the first. Those
 *     are ON CONFLICT semantics, so they are tested against real Postgres - a mocked
 *     repository would only test the mock.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import 'dotenv/config';
import { eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { contacts, leads } from '../src/db/schema.js';
import { extractRequestId, extractFormFields } from '../src/services/leadMatcher.js';
import {
  upsertLeadFromImport,
  claimLeadByRequestId,
  ensureOrganicLead,
  getCampaignSummary,
  applyAiLeadUpdate,
  patchLead,
} from '../src/repositories/leads.js';

// ─── parser ─────────────────────────────────────────────────────────────────

// Verbatim from the production dump.
const PROD_TEMPLATE = `Legacy

Nama: budi
Nomor WhatsApp: 081200000001
Apa Yang Anda Butuhkan?: saya mau kulak gembok yang murah , untuk saya jual lagi. apakah gembok merk HS rekomen yaaa ?
Area: saya lokasi di Kota Malang
Budget: menyesuaikan , pembayaran bisa qris ?

Request ID: ada4cdd9-085f-43f2-8629-a55a84600cef`;

// The other live shape: the customer typed something before the template pasted itself in.
const GREETING_PREFIXED = `Hallo selamat sore...boleh min

Nama: Ar
Nomor WhatsApp: 081200000002

Request ID: 8266d121-a5d4-4ee5-914f-e24502f3f869`;

describe('extractRequestId', () => {
  it('pulls the id out of the production template', () => {
    expect(extractRequestId(PROD_TEMPLATE)).toBe('ada4cdd9-085f-43f2-8629-a55a84600cef');
  });

  it('still matches when the customer typed something first', () => {
    expect(extractRequestId(GREETING_PREFIXED)).toBe('8266d121-a5d4-4ee5-914f-e24502f3f869');
  });

  it('survives WhatsApp bold and odd spacing', () => {
    expect(extractRequestId('*Request ID:* ada4cdd9-085f-43f2-8629-a55a84600cef')).toBe(
      'ada4cdd9-085f-43f2-8629-a55a84600cef'
    );
    expect(extractRequestId('request  id - ADA4CDD9-085F-43F2-8629-A55A84600CEF')).toBe(
      'ada4cdd9-085f-43f2-8629-a55a84600cef'
    );
  });

  it('ignores a bare uuid with no label — that would invent campaign leads', () => {
    expect(extractRequestId('ada4cdd9-085f-43f2-8629-a55a84600cef')).toBeNull();
  });

  it('returns null for an ordinary message', () => {
    expect(extractRequestId('Halo kak, ada gembok?')).toBeNull();
  });
});

describe('extractFormFields', () => {
  it('takes whatever labels the form used', () => {
    expect(extractFormFields(PROD_TEMPLATE)).toEqual({
      nama: 'budi',
      nomor_whatsapp: '081200000001',
      apa_yang_anda_butuhkan:
        'saya mau kulak gembok yang murah , untuk saya jual lagi. apakah gembok merk HS rekomen yaaa ?',
      area: 'saya lokasi di Kota Malang',
      budget: 'menyesuaikan , pembayaran bisa qris ?',
    });
  });

  it('handles the shorter field set without inventing keys', () => {
    expect(extractFormFields(GREETING_PREFIXED)).toEqual({
      nama: 'Ar',
      nomor_whatsapp: '081200000002',
    });
  });

  it('reads the other form shape marketing sent (different labels entirely)', () => {
    const smartIt = `SMART IT

Nama: yo
No WhatsApp: yo
Nama Perusahaan: yo
Deadline Penyelesaian: 6-12 months
Catatan: test

Request ID: 3280e4c8-9902-495e-b70b-d106bbb1f06a`;
    expect(extractFormFields(smartIt)).toEqual({
      nama: 'yo',
      no_whatsapp: 'yo',
      nama_perusahaan: 'yo',
      deadline_penyelesaian: '6-12 months',
      catatan: 'test',
    });
  });

  it('never keeps the Request ID line itself as a field', () => {
    expect(extractFormFields(PROD_TEMPLATE)).not.toHaveProperty('request_id');
  });
});

// ─── upsert ordering (real Postgres) ────────────────────────────────────────

const TEST_PREFIX = '__leads_test__';
const RID_IMPORT_FIRST = '11111111-aaaa-4aaa-8aaa-111111111111';
const RID_WHATSAPP_FIRST = '22222222-bbbb-4bbb-8bbb-222222222222';
const RID_CONTESTED = '33333333-cccc-4ccc-8ccc-333333333333';
const RID_SYNC_ORDER = '44444444-dddd-4ddd-8ddd-444444444444';
const TEST_RIDS = [RID_IMPORT_FIRST, RID_WHATSAPP_FIRST, RID_CONTESTED, RID_SYNC_ORDER];

describe('leads upserts — either order, never clobbering', () => {
  let contactA: string;
  let contactB: string;
  let organicContact: string;
  let syncOrderContact: string;
  let backdateContact: string;

  async function cleanup() {
    const db = getDb();
    await db.delete(leads).where(inArray(leads.requestId, TEST_RIDS));
    await db.execute(sql`
      DELETE FROM leads WHERE contact_id IN (
        SELECT id FROM contacts WHERE wa_id LIKE ${`${TEST_PREFIX}%`}
      )
    `);
    await db.delete(contacts).where(sql`${contacts.waId} LIKE ${`${TEST_PREFIX}%`}`);
  }

  beforeAll(async () => {
    await cleanup();
    const db = getDb();
    const rows = await db
      .insert(contacts)
      .values([
        { waId: `${TEST_PREFIX}a` },
        { waId: `${TEST_PREFIX}b` },
        { waId: `${TEST_PREFIX}organic` },
        { waId: `${TEST_PREFIX}syncorder` },
        { waId: `${TEST_PREFIX}backdate` },
      ])
      .returning({ id: contacts.id, waId: contacts.waId });
    contactA = rows.find((r) => r.waId === `${TEST_PREFIX}a`)!.id;
    contactB = rows.find((r) => r.waId === `${TEST_PREFIX}b`)!.id;
    organicContact = rows.find((r) => r.waId === `${TEST_PREFIX}organic`)!.id;
    syncOrderContact = rows.find((r) => r.waId === `${TEST_PREFIX}syncorder`)!.id;
    backdateContact = rows.find((r) => r.waId === `${TEST_PREFIX}backdate`)!.id;
  });

  afterAll(cleanup);

  async function readLead(requestId: string) {
    const db = getDb();
    const [row] = await db.select().from(leads).where(eq(leads.requestId, requestId)).limit(1);
    return row;
  }

  it('import then WhatsApp: one row holding both halves', async () => {
    await upsertLeadFromImport({
      requestId: RID_IMPORT_FIRST,
      utmSource: 'instagram',
      utmCampaign: 'testingcookie',
      payload: { form_name: 'Legacy' },
    });
    await claimLeadByRequestId(RID_IMPORT_FIRST, contactA, { nama: 'budi' }, new Date());

    const row = await readLead(RID_IMPORT_FIRST);
    expect(row?.utmCampaign).toBe('testingcookie');
    expect(row?.contactId).toBe(contactA);
    expect(row?.matchedAt).not.toBeNull();
    // Both writers contribute to the same jsonb bag rather than replacing it.
    expect(row?.payload).toEqual({ form_name: 'Legacy', nama: 'budi' });
  });

  it('WhatsApp then import: same end state, and the match is not wiped', async () => {
    await claimLeadByRequestId(RID_WHATSAPP_FIRST, contactA, { nama: 'anas' }, new Date());
    await upsertLeadFromImport({
      requestId: RID_WHATSAPP_FIRST,
      utmSource: 'facebook',
      utmCampaign: 'fb_diskon',
    });

    const row = await readLead(RID_WHATSAPP_FIRST);
    expect(row?.utmCampaign).toBe('fb_diskon');
    expect(row?.contactId).toBe(contactA);
    expect(row?.matchedAt).not.toBeNull();
  });

  it('re-importing does not reset a status a salesperson set', async () => {
    const db = getDb();
    await db
      .update(leads)
      .set({ status: 'won', dealValueIdr: '5000000' })
      .where(eq(leads.requestId, RID_WHATSAPP_FIRST));

    await upsertLeadFromImport({ requestId: RID_WHATSAPP_FIRST, utmCampaign: 'fb_diskon' });

    const row = await readLead(RID_WHATSAPP_FIRST);
    expect(row?.status).toBe('won');
    expect(row?.dealValueIdr).toBe('5000000');
  });

  it('claim-once: a forwarded template cannot steal an existing match', async () => {
    await claimLeadByRequestId(RID_CONTESTED, contactA, {}, new Date());
    await claimLeadByRequestId(RID_CONTESTED, contactB, {}, new Date());

    const row = await readLead(RID_CONTESTED);
    expect(row?.contactId).toBe(contactA);
  });

  it('organic leads are created once per contact and never duplicated', async () => {
    const db = getDb();
    await ensureOrganicLead(organicContact, new Date());
    await ensureOrganicLead(organicContact, new Date());

    const rows = await db.select().from(leads).where(eq(leads.contactId, organicContact));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.requestId).toBeNull();
  });

  it('a contact with a campaign lead never also gets an organic one', async () => {
    const db = getDb();
    await ensureOrganicLead(contactA, new Date());

    const rows = await db
      .select()
      .from(leads)
      .where(sql`${leads.contactId} = ${contactA} AND ${leads.requestId} IS NULL`);
    expect(rows).toHaveLength(0);
  });

  // chakraSync imports a chat newest first: a plain message sent after the template is imported
  // before it and creates an organic lead. Production 2026-11-10: 6 customers counted twice.
  it('a template imported after a later plain message folds that organic lead into the campaign lead', async () => {
    const db = getDb();
    const template = new Date('2026-09-15T02:58:28Z');
    const later = new Date('2026-09-15T03:00:33Z');
    await ensureOrganicLead(syncOrderContact, later);
    await db.execute(sql`UPDATE leads SET lead_temperature = 'hot' WHERE contact_id = ${syncOrderContact}`);
    await claimLeadByRequestId(RID_SYNC_ORDER, syncOrderContact, { nama: 'x' }, template);

    const rows = await db.select().from(leads).where(eq(leads.contactId, syncOrderContact));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ requestId: RID_SYNC_ORDER, leadTemperature: 'hot', firstContactAt: template });
  });

  it('an organic lead that has moved on is not folded in', async () => {
    const db = getDb();
    await db.execute(sql`DELETE FROM leads WHERE contact_id = ${syncOrderContact}`);
    await ensureOrganicLead(syncOrderContact, new Date('2026-09-15T03:00:33Z'));
    await db.execute(sql`UPDATE leads SET status = 'contacted' WHERE contact_id = ${syncOrderContact}`);
    await claimLeadByRequestId(RID_SYNC_ORDER, syncOrderContact, {}, new Date('2026-09-15T02:58:28Z'));
    expect(await db.select().from(leads).where(eq(leads.contactId, syncOrderContact))).toHaveLength(2);
  });

  it('an older message moves an organic lead back to it, creation event included', async () => {
    const db = getDb();
    const later = new Date('2026-09-09T08:17:23Z');
    const first = new Date('2026-06-13T01:18:14Z');
    await ensureOrganicLead(backdateContact, later);
    await ensureOrganicLead(backdateContact, first);
    await ensureOrganicLead(backdateContact, later); // a newer one never moves it forward

    const [row] = await db.select().from(leads).where(eq(leads.contactId, backdateContact));
    expect(row).toMatchObject({ submittedAt: first, matchedAt: first, firstContactAt: first });
    const ev = await db.execute<{ created_at: Date }>(sql`
      SELECT created_at FROM lead_events WHERE lead_id = ${row!.id} AND from_status IS NULL AND to_status = 'new'`);
    expect(new Date(ev.rows[0]!.created_at)).toEqual(first);
  });

  it('an older message moves only first_contact_at of a campaign lead, never its form or match time', async () => {
    const db = getDb();
    const before = await readLead(RID_SYNC_ORDER);
    await ensureOrganicLead(syncOrderContact, new Date('2026-07-31T01:17:15Z'));
    const after = await readLead(RID_SYNC_ORDER);
    expect(after?.firstContactAt).toEqual(new Date('2026-07-31T01:17:15Z'));
    expect(after?.submittedAt).toEqual(before?.submittedAt);
    expect(after?.matchedAt).toEqual(before?.matchedAt);
    await db.execute(sql`DELETE FROM leads WHERE contact_id = ${syncOrderContact}`);
  });

  it('the campaign summary counts each lead once and buckets organics separately', async () => {
    const summary = await getCampaignSummary({});
    const byCampaign = new Map(summary.map((r) => [r.campaign, r]));

    const cookie = byCampaign.get('testingcookie');
    expect(cookie?.leads).toBeGreaterThanOrEqual(1);
    expect(cookie?.chats).toBeGreaterThanOrEqual(1);

    const organik = byCampaign.get('Organik');
    expect(organik?.leads).toBeGreaterThanOrEqual(1);
    // Every organic lead is by definition already in a chat.
    expect(organik?.chats).toBe(organik?.leads);

    const diskon = byCampaign.get('fb_diskon');
    expect(diskon?.won).toBeGreaterThanOrEqual(1);
    expect(diskon?.dealValueIdr).toBeGreaterThanOrEqual(5_000_000);
  });
});

// ─── the AI's half of the row ───────────────────────────────────────────────

/**
 * applyAiLeadUpdate is raw SQL with a CASE-guarded write, so it is tested against real
 * Postgres for the same reason the upserts above are: the whole behaviour IS the SQL.
 *
 * The rule it has to enforce: the model keeps status and deal value current until a human
 * edits either one, and never again afterwards.
 */
describe('applyAiLeadUpdate — the human edit wins', () => {
  const AI_PREFIX = '__leads_ai_test__';
  let contactId: string;

  async function cleanup() {
    const db = getDb();
    const mine = sql`(SELECT id FROM contacts WHERE wa_id LIKE ${`${AI_PREFIX}%`})`;
    await db.execute(sql`DELETE FROM leads WHERE contact_id IN ${mine}`);
    await db.execute(sql`DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE contact_id IN ${mine})`);
    await db.execute(sql`DELETE FROM conversations WHERE contact_id IN ${mine}`);
    await db.delete(contacts).where(sql`${contacts.waId} LIKE ${`${AI_PREFIX}%`}`);
  }

  beforeAll(async () => {
    await cleanup();
    const db = getDb();
    const [contact] = await db
      .insert(contacts)
      .values({ waId: `${AI_PREFIX}a` })
      .returning({ id: contacts.id });
    contactId = contact!.id;
    await ensureOrganicLead(contactId, new Date());
  });

  afterAll(cleanup);

  async function readLead() {
    const db = getDb();
    const [row] = await db.select().from(leads).where(eq(leads.contactId, contactId)).limit(1);
    return row!;
  }

  it('writes temperature and the order value, never the stage or the order count', async () => {
    await applyAiLeadUpdate(contactId, {
      temperature: 'hot',
      status: 'quoted',
      orderConfirmed: true,
      orderValueIdr: 450000,
    });

    const row = await readLead();
    expect(row.leadTemperature).toBe('hot');
    expect(row.status).toBe('new');
    // The count is the lead-insights pass's (recordLeadOrders): a second counter would double it.
    expect(row.totalOrders).toBe(0);
    expect(Number(row.dealValueIdr)).toBe(450000);
  });

  it('accumulates a second order value rather than replacing the first', async () => {
    await applyAiLeadUpdate(contactId, { orderConfirmed: true, orderValueIdr: 50000 });
    expect(Number((await readLead()).dealValueIdr)).toBe(500000);
  });

  it('leaves the row alone when the model reported nothing', async () => {
    const before = await readLead();
    await applyAiLeadUpdate(contactId, {});

    const row = await readLead();
    expect(row.totalOrders).toBe(before.totalOrders);
    expect(row.leadTemperature).toBe(before.leadTemperature);
    expect(row.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it('a staff deal value is never changed by the AI, and records who set it', async () => {
    const { rows } = await getDb().execute<{ id: string }>(sql`SELECT id FROM staff_profiles ORDER BY created_at LIMIT 1`);
    const staffId = rows[0]?.id;
    const before = await readLead();
    await patchLead(before.id, { dealValueIdr: 999000, ...(staffId ? { staffId } : {}) });
    await applyAiLeadUpdate(contactId, { temperature: 'cold', orderConfirmed: true, orderValueIdr: 1000 });

    const row = await readLead();
    expect(Number(row.dealValueIdr)).toBe(999000);
    expect(row.dealValueSetAt).not.toBeNull();
    if (staffId) expect(row.dealValueSetBy).toBe(staffId);
    // Each field locks on its own: a deal value locks neither the status nor the order count.
    expect(row.humanUpdatedAt).toBeNull();
    expect(row.totalOrdersSetAt).toBeNull();
    // Temperature has no input on the page, so nothing can contradict the model.
    expect(row.leadTemperature).toBe('cold');
  });

  it('a staff order count is never recounted, while recorded orders still go on the record', async () => {
    const { resetLeadsForContact, recordLeadOrders, listLeadOrders } = await import('../src/repositories/leads.js');
    await resetLeadsForContact(contactId);
    const db = getDb();
    const conv = await db.execute<{ id: string }>(sql`
      INSERT INTO conversations (contact_id, phone_number_id)
      SELECT ${contactId}, id FROM phone_numbers ORDER BY created_at LIMIT 1
      ON CONFLICT DO NOTHING RETURNING id`);
    const convId = conv.rows[0]?.id
      ?? (await db.execute<{ id: string }>(sql`SELECT id FROM conversations WHERE contact_id = ${contactId} LIMIT 1`)).rows[0]!.id;
    const msg = async (body: string) => (await db.execute<{ id: string }>(sql`
      INSERT INTO messages (conversation_id, role, body) VALUES (${convId}, 'user', ${body}) RETURNING id`)).rows[0]!.id;
    const m1 = await msg('Pesan Grendel vintage 2 dos');
    const m2 = await msg('oke saya ambil 20 set');

    const lead = await readLead();
    expect(await recordLeadOrders(lead.id, [{ messageId: m1, evidence: 'Pesan Grendel vintage 2 dos' }])).toBe(1);
    // The same message again is the same order.
    expect(await recordLeadOrders(lead.id, [{ messageId: m1, evidence: 'Pesan Grendel vintage 2 dos' }])).toBe(0);
    expect((await readLead()).totalOrders).toBe(1);

    await patchLead(lead.id, { totalOrders: 9 });
    expect(await recordLeadOrders(lead.id, [{ messageId: m2, evidence: 'oke saya ambil 20 set' }])).toBe(1);
    const row = await readLead();
    expect(row.totalOrders).toBe(9);
    expect(row.totalOrdersSetAt).not.toBeNull();
    expect(row.humanUpdatedAt).toBeNull(); // the status stays the AI's
    expect((await listLeadOrders(lead.id)).map((o) => o.evidence)).toEqual(['Pesan Grendel vintage 2 dos', 'oke saya ambil 20 set']);
  });

  it('a staff status locks the status only', async () => {
    const before = await readLead();
    await patchLead(before.id, { status: 'won' });
    const row = await readLead();
    expect(row.humanUpdatedAt).not.toBeNull();
    expect(row.dealValueSetAt).toBeNull();
  });

  it('/new clears every lock and recorded order along with the sales state', async () => {
    const { resetLeadsForContact, listLeadOrders } = await import('../src/repositories/leads.js');
    await resetLeadsForContact(contactId);

    const row = await readLead();
    expect(row.status).toBe('new');
    expect(row.dealValueIdr).toBeNull();
    expect(row.leadTemperature).toBeNull();
    expect(row.totalOrders).toBe(0);
    expect(row.humanUpdatedAt).toBeNull();
    expect(row.totalOrdersSetAt).toBeNull();
    expect(row.dealValueSetAt).toBeNull();
    expect(await listLeadOrders(row.id)).toEqual([]);
    const db = getDb();
    await db.execute(sql`DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE contact_id = ${contactId})`);
    await db.execute(sql`DELETE FROM conversations WHERE contact_id = ${contactId}`);
  });
});

// ─── kind and unreplied filters ─────────────────────────────────────────────

describe('listLeads — kind and unreplied filters', () => {
  const K = '__leads_kind_test__';
  const ids: Record<string, string> = {};
  let staffId: string;

  async function cleanup() {
    const db = getDb();
    const mine = sql`(SELECT id FROM contacts WHERE wa_id LIKE ${`${K}%`})`;
    await db.execute(sql`DELETE FROM lead_events WHERE lead_id IN (SELECT id FROM leads WHERE contact_id IN ${mine})`);
    await db.execute(sql`DELETE FROM leads WHERE contact_id IN ${mine}`);
    await db.execute(sql`DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE contact_id IN ${mine})`);
    await db.execute(sql`DELETE FROM conversations WHERE contact_id IN ${mine}`);
    await db.execute(sql`DELETE FROM contacts WHERE wa_id LIKE ${`${K}%`}`);
    await db.execute(sql`DELETE FROM phone_numbers WHERE number LIKE ${`${K}%`}`);
    await db.execute(sql`DELETE FROM staff_profiles WHERE email LIKE ${`${K}%`}`);
  }

  beforeAll(async () => {
    await cleanup();
    const db = getDb();
    const num = await db.execute<{ id: string }>(sql`
      INSERT INTO phone_numbers (number, waba_id, phone_number_id) VALUES (${`${K}n`}, 'test', 'test') RETURNING id`);
    const phoneId = num.rows[0]!.id;
    const staff = await db.execute<{ id: string }>(sql`
      INSERT INTO staff_profiles (email, password_hash, name) VALUES (${`${K}@example.test`}, 'x', 'T') RETURNING id`);
    staffId = staff.rows[0]!.id;

    // name -> [kind, [role, minutes ago]...]
    const spec: Record<string, [string, Array<[string, number]>]> = {
      // Mostly under 5 minutes old, from when the lead-insights pass tests could pick any quiet
      // chat; they are now scoped to their own conversations, so older waits are safe too.
      waiting: ['lead', [['assistant', 3.5], ['user', 2.5]]],
      waitedLonger: ['lead', [['user', 4.5]]],
      answered: ['lead', [['user', 4], ['assistant', 2], ['system', 1]]],
      courier: ['kurir', [['user', 1.5]]],
      // Days, in minutes: inside and past the 7-day unreplied window.
      waited2Days: ['lead', [['user', 2 * 1440]]],
      waited10Days: ['lead', [['user', 10 * 1440]]],
    };
    for (const [name, [kind, msgs]] of Object.entries(spec)) {
      const c = await db.execute<{ id: string }>(sql`
        INSERT INTO contacts (wa_id) VALUES (${`${K}${name}`}) RETURNING id`);
      const conv = await db.execute<{ id: string }>(sql`
        INSERT INTO conversations (contact_id, phone_number_id) VALUES (${c.rows[0]!.id}, ${phoneId}) RETURNING id`);
      for (const [role, mins] of msgs) {
        await db.execute(sql`
          INSERT INTO messages (conversation_id, role, body, created_at)
          VALUES (${conv.rows[0]!.id}, ${role}, 'x', now() - (${mins} * interval '1 minute'))`);
      }
      const l = await db.execute<{ id: string }>(sql`
        INSERT INTO leads (contact_id, kind) VALUES (${c.rows[0]!.id}, ${kind}) RETURNING id`);
      ids[name] = l.rows[0]!.id;
    }

    // A renewed customer: an old Lost lead and the new lead that replaced it, customer waiting.
    const rc = await db.execute<{ id: string }>(sql`INSERT INTO contacts (wa_id) VALUES (${`${K}renewed`}) RETURNING id`);
    const rconv = await db.execute<{ id: string }>(sql`
      INSERT INTO conversations (contact_id, phone_number_id) VALUES (${rc.rows[0]!.id}, ${phoneId}) RETURNING id`);
    await db.execute(sql`
      INSERT INTO messages (conversation_id, role, body, created_at)
      VALUES (${rconv.rows[0]!.id}, 'user', 'x', now() - interval '2 minutes')`);
    const old = await db.execute<{ id: string }>(sql`
      INSERT INTO leads (contact_id, kind, status, submitted_at)
      VALUES (${rc.rows[0]!.id}, 'lead', 'lost', now() - interval '60 days') RETURNING id`);
    const renewed = await db.execute<{ id: string }>(sql`
      INSERT INTO leads (contact_id, kind, previous_lead_id) VALUES (${rc.rows[0]!.id}, 'lead', ${old.rows[0]!.id}) RETURNING id`);
    ids.renewedOld = old.rows[0]!.id;
    ids.renewedNew = renewed.rows[0]!.id;
  });

  afterAll(cleanup);

  const mine = (items: Array<{ id: string }>) =>
    items.filter((i) => Object.values(ids).includes(i.id)).map((i) => i.id);
  const all = { page: 1, limit: 0 };

  it('hides non-lead kinds by default and from the campaign summary', async () => {
    const { listLeads } = await import('../src/repositories/leads.js');
    const { items } = await listLeads(all);
    expect(mine(items)).not.toContain(ids.courier);
    expect(mine(items)).toContain(ids.waiting);

    // The courier in a campaign bucket of its own: the shared Organik bucket moves whenever another
    // test file inserts an organic lead in parallel, which made a before/after count flaky.
    await getDb().execute(sql`UPDATE leads SET utm_campaign = ${K} WHERE id = ${ids.courier}`);
    const count = async () =>
      (await getCampaignSummary({})).find((r) => r.campaign === K)?.leads ?? 0;
    const before = await count();
    await getDb().execute(sql`UPDATE leads SET kind = 'lead' WHERE id = ${ids.courier}`);
    const after = await count();
    await getDb().execute(sql`UPDATE leads SET kind = 'kurir', utm_campaign = NULL WHERE id = ${ids.courier}`);
    expect(before).toBe(0);
    expect(after).toBe(1);
  });

  it('kind=non_lead returns every other kind, a concrete kind only that one', async () => {
    const { listLeads } = await import('../src/repositories/leads.js');
    expect(mine((await listLeads({ ...all, kind: 'non_lead' })).items)).toEqual([ids.courier]);
    expect(mine((await listLeads({ ...all, kind: 'kurir' })).items)).toEqual([ids.courier]);
    expect(mine((await listLeads({ ...all, kind: 'supplier' })).items)).toEqual([]);
  });

  it('unreplied=true keeps leads whose newest chat row is the customer, oldest wait first', async () => {
    const { listLeads } = await import('../src/repositories/leads.js');
    const { items, total } = await listLeads({ ...all, unreplied: true });
    // The renewed customer is listed once, as the renewed lead - never as the old Lost one.
    // waited10Days is past UNREPLIED_MAX_AGE_DAYS; the 2-day wait is the oldest one still listed.
    expect(mine(items)).toEqual([ids.waited2Days, ids.waitedLonger, ids.waiting, ids.renewedNew]);
    expect(total).toBeGreaterThanOrEqual(4);
    // The count runs the same filter: checked on this file's rows only, since other test files
    // add and remove waiting chats between the list query and the count query.
    const own = await listLeads({ ...all, unreplied: true, search: K });
    expect(own.items.map((i) => i.id)).toEqual(mine(items));
    expect(own.total).toBe(own.items.length);
    expect(items.find((i) => i.id === ids.waitedLonger)!.waitingSince).toBeInstanceOf(Date);
  });

  it('waitingSince is computed without the filter, and null when the bot spoke last', async () => {
    const { listLeads } = await import('../src/repositories/leads.js');
    const { items } = await listLeads(all);
    expect(items.find((i) => i.id === ids.waiting)!.waitingSince).toBeInstanceOf(Date);
    expect(items.find((i) => i.id === ids.answered)!.waitingSince).toBeNull();
  });

  it('lastChatAt is the newest customer/bot row, and sort=last_chat orders by it either way', async () => {
    const { listLeads } = await import('../src/repositories/leads.js');
    const base = { ...all, search: K };
    const { items } = await listLeads(base);
    // answered's newest row is a system note (1 min); the chat itself last moved 2 min ago.
    const answered = items.find((i) => i.id === ids.answered)!;
    expect(answered.lastChatAt).toBeInstanceOf(Date);
    expect(Date.now() - answered.lastChatAt!.getTime()).toBeGreaterThan(110_000);

    // The renewed pair shares one chat (a tie); the rest are minutes or days apart.
    const order = (list: Array<{ id: string }>) =>
      mine(list).filter((id) => id !== ids.renewedOld && id !== ids.renewedNew);
    const newestFirst = [ids.answered, ids.waiting, ids.waitedLonger, ids.waited2Days, ids.waited10Days];
    expect(order((await listLeads({ ...base, sort: 'last_chat' })).items)).toEqual(newestFirst);
    expect(order((await listLeads({ ...base, sort: 'last_chat', order: 'asc' })).items)).toEqual([...newestFirst].reverse());

    const { LeadsQuerySchema } = await import('../src/domain/schemas.js');
    expect(LeadsQuerySchema.safeParse({ sort: 'last_chat', order: 'asc' }).success).toBe(true);
    expect(LeadsQuerySchema.safeParse({ sort: 'name' }).success).toBe(false);
  });

  it('the schemas accept unreplied only as true/false and carry the PATCH fields', async () => {
    const { LeadsQuerySchema, PatchLeadBodySchema } = await import('../src/domain/schemas.js');
    expect(LeadsQuerySchema.parse({ unreplied: 'false' }).unreplied).toBe(false);
    expect(LeadsQuerySchema.parse({ unreplied: 'true' }).unreplied).toBe(true);
    expect(LeadsQuerySchema.safeParse({ unreplied: 'maybe' }).success).toBe(false);
    expect(LeadsQuerySchema.safeParse({ kind: 'non_lead' }).success).toBe(true);
    expect(LeadsQuerySchema.safeParse({ kind: 'bogus' }).success).toBe(false);
    expect(PatchLeadBodySchema.safeParse({ kind: 'lead', staffId, lostReason: null }).success).toBe(true);
    expect(PatchLeadBodySchema.safeParse({ staffId: 'nope' }).success).toBe(false);
    expect(PatchLeadBodySchema.safeParse({ lostReason: 'x' }).success).toBe(false);
  });

  it('a staff kind patch writes an event and marks the kind staff-set', async () => {
    await patchLead(ids.courier, { kind: 'lead', staffId });
    const row = await getDb().execute<{ kind_set_by: string; staff_id: string; to_kind: string }>(sql`
      SELECT l.kind_set_by, e.staff_id, e.to_kind FROM leads l JOIN lead_events e ON e.lead_id = l.id
      WHERE l.id = ${ids.courier}`);
    expect(row.rows[0]).toMatchObject({ kind_set_by: 'staff', staff_id: staffId, to_kind: 'lead' });
    await getDb().execute(sql`UPDATE leads SET kind = 'kurir' WHERE id = ${ids.courier}`);
  });
});
