/**
 * lead-insights-pass.test.ts
 *
 * The background pass that fills a lead's Tipe / Hot-Cold / Minat from the chat itself, whether
 * the bot replied or not (services/leadInsights.ts). The model is mocked; the SQL is not - the
 * due-query, the watermark and the fill-only profile merge are what can quietly go wrong.
 *
 * Needs DATABASE_URL. Every pass and due-query is scoped to the test's own conversation
 * (`conversationIds`): the DB is shared with other test files running in
 * parallel, so "the newest due chat" could be anyone's.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import 'dotenv/config';

const mockCreate = vi.fn();
vi.mock('../src/services/claude.js', () => ({
  getClient: () => ({ messages: { create: mockCreate } }),
  isDevMode: () => false,
  agentQuery: vi.fn(),
  logUsageLine: vi.fn(),
  CLAUDE_MODEL: 'test-model',
}));

import { eq, sql } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { contacts, phoneNumbers, leads } from '../src/db/schema.js';
import { upsertConversation, insertMessage, listConversationsDueForInsights } from '../src/repositories/conversations.js';
import { getContactProfile, upsertContactProfile, deleteContactProfile } from '../src/repositories/contactProfiles.js';
import { ensureOrganicLead } from '../src/repositories/leads.js';
import { runLeadInsightsPass } from '../src/services/leadInsights.js';
import { getLeadReopenAfterDays } from '../src/repositories/appSettings.js';

const TEST_PREFIX = '__leadinsights_test__';
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

/** The main answer, and (for the order call, told apart by its prompt) the order message numbers. */
function answer(fields: Record<string, unknown>, orderNumbers: number[] = []) {
  mockCreate.mockImplementation(async ({ system }: { system: string }) => ({
    content: [{
      type: 'text',
      text: system.includes('Setiap pesan Pelanggan diberi nomor')
        ? JSON.stringify({ orders: orderNumbers })
        : JSON.stringify({ is_sales_conversation: true, ...fields }),
    }],
    usage: { input_tokens: 1, output_tokens: 1 },
  }));
}

describe('lead-insights pass', () => {
  let convId: string;
  let contactId: string;
  let leadId: string;

  async function cleanup() {
    const db = getDb();
    await db.execute(sql`
      DELETE FROM messages WHERE conversation_id IN (
        SELECT c.id FROM conversations c JOIN contacts ct ON ct.id = c.contact_id
        WHERE ct.wa_id LIKE ${`${TEST_PREFIX}%`}
      )
    `);
    await db.execute(sql`DELETE FROM conversations WHERE contact_id IN (SELECT id FROM contacts WHERE wa_id LIKE ${`${TEST_PREFIX}%`})`);
    await db.execute(sql`DELETE FROM leads WHERE contact_id IN (SELECT id FROM contacts WHERE wa_id LIKE ${`${TEST_PREFIX}%`})`);
    await db.execute(sql`DELETE FROM contact_profiles WHERE contact_id IN (SELECT id FROM contacts WHERE wa_id LIKE ${`${TEST_PREFIX}%`})`);
    await db.execute(sql`DELETE FROM contacts WHERE wa_id LIKE ${`${TEST_PREFIX}%`}`);
    await db.execute(sql`DELETE FROM phone_numbers WHERE number LIKE ${`${TEST_PREFIX}%`}`);
  }

  beforeAll(async () => {
    await cleanup();
    const db = getDb();
    const [contact] = await db.insert(contacts).values({ waId: `${TEST_PREFIX}a` }).returning();
    const [number] = await db.insert(phoneNumbers).values({ number: `${TEST_PREFIX}n`, wabaId: 'test', phoneNumberId: 'test' }).returning();
    contactId = contact!.id;
    convId = (await upsertConversation(contactId, number!.id)).id;
    await ensureOrganicLead(contactId, new Date());
    leadId = (await getDb().select().from(leads).where(eq(leads.contactId, contactId)))[0]!.id;
  });

  beforeEach(async () => {
    mockCreate.mockReset();
    const db = getDb();
    await db.execute(sql`DELETE FROM messages WHERE conversation_id = ${convId}`);
    await db.execute(sql`UPDATE conversations SET insights_extracted_at = NULL WHERE id = ${convId}`);
    // Back to a fresh organic lead (renewals from earlier tests are removed first).
    await db.execute(sql`DELETE FROM leads WHERE contact_id = ${contactId} AND id <> ${leadId}`);
    await db.execute(sql`UPDATE leads SET brands = '{}', items = '[]'::jsonb, lead_temperature = NULL, status = 'new', kind = 'lead', kind_set_by = NULL,
      lost_reason = NULL, outcome_evidence = NULL, outcome_message_id = NULL, closed_at = NULL, human_updated_at = NULL,
      total_orders = 0, total_orders_set_at = NULL, deal_value_set_at = NULL WHERE id = ${leadId}`);
    await db.execute(sql`DELETE FROM lead_orders WHERE lead_id = ${leadId}`);
    // The lifecycle starts before every test's messages (as a lead created at the first message
    // does), and no earlier test's reopen event moves that start.
    await db.execute(sql`UPDATE leads SET first_contact_at = now() - interval '1 day', matched_at = now() - interval '1 day',
      submitted_at = now() - interval '1 day' WHERE id = ${leadId}`);
    await db.execute(sql`DELETE FROM lead_events WHERE lead_id = ${leadId}`);
    delete process.env['LEAD_STAGE_AI'];
    await deleteContactProfile(contactId);
  });

  afterAll(cleanup);

  const only = () => ({ conversationIds: [convId] });
  const isDue = async () => (await listConversationsDueForInsights(minutesAgo(5), 1, only()))[0]?.id === convId;

  it('waits until the customer has gone quiet, reads once, and again only after a new message', async () => {
    await insertMessage({ conversationId: convId, role: 'user', body: 'ada box kue 20x20?', createdAt: minutesAgo(1) });
    expect(await isDue()).toBe(false); // the live bot's chat for now

    await getDb().execute(sql`UPDATE messages SET created_at = ${minutesAgo(6).toISOString()}::timestamptz WHERE conversation_id = ${convId}`);
    expect(await isDue()).toBe(true);

    answer({ lead_temperature: 'hot' });
    expect(await runLeadInsightsPass(1, only())).toBe(1);
    expect(await isDue()).toBe(false);
    // Stamped at the customer's message, not at now(): a message that lands during the call stays due.
    const { rows } = await getDb().execute<{ stamped: boolean }>(sql`
      SELECT c.insights_extracted_at = max(m.created_at) AS stamped
      FROM conversations c JOIN messages m ON m.conversation_id = c.id
      WHERE c.id = ${convId} GROUP BY c.id`);
    expect(rows[0]?.stamped).toBe(true);

    await insertMessage({ conversationId: convId, role: 'user', body: 'untuk katering', createdAt: minutesAgo(5.5) });
    expect(await isDue()).toBe(true);
  });

  // Production 2026-11-10: a JS Date stamp (ms) sat up to 999 µs before the message, which then stayed
  // "newer than the watermark": 20 chats re-read every sweep, five leads' kind flipped 191 times.
  it('is not due again after one read when the message time has microseconds', async () => {
    await insertMessage({ conversationId: convId, role: 'user', body: 'Pending yaa kak', createdAt: minutesAgo(10) });
    await getDb().execute(sql`UPDATE messages SET created_at = date_trunc('millisecond', created_at) + interval '504 microseconds'
      WHERE conversation_id = ${convId}`);
    expect(await isDue()).toBe(true);
    answer({ lead_temperature: null });
    expect(await runLeadInsightsPass(1, only())).toBe(1);
    expect(await isDue()).toBe(false);
    expect(await runLeadInsightsPass(1, only())).toBe(0);
  });

  // Client 2026-11-10: staff take most orders off the phone, so the live bot never counted them.
  it('counts each order message the customer wrote, once, and only real customer messages', async () => {
    await insertMessage({ conversationId: convId, role: 'user', body: 'Pesan box nasi 20x20 2000 pcs, box kue 1000 pcs', createdAt: minutesAgo(30) });
    await insertMessage({ conversationId: convId, role: 'assistant', senderName: 'Tim CS', body: 'Baik pak, saya cekkan dulu orderannya', createdAt: minutesAgo(29) });
    await insertMessage({ conversationId: convId, role: 'user', body: 'Pesan kertas supreme 30x30 5 rim', createdAt: minutesAgo(20) });
    // Customer messages [1] and [2]; [2] twice, and [9] does not exist.
    answer({ lead_kind: 'lead' }, [1, 2, 2, 9]);
    expect(await runLeadInsightsPass(1, only())).toBe(1);
    const count = async () => (await getDb().select().from(leads).where(eq(leads.id, leadId)))[0]!.totalOrders;
    expect(await count()).toBe(2);

    // Read again after a new message: the same two orders are not counted twice.
    await insertMessage({ conversationId: convId, role: 'user', body: 'ditunggu ya', createdAt: minutesAgo(10) });
    expect(await runLeadInsightsPass(1, only())).toBe(1);
    expect(await count()).toBe(2);
  });

  it('never recounts an order total staff typed, and still keeps the order on record', async () => {
    await getDb().execute(sql`UPDATE leads SET total_orders = 7, total_orders_set_at = now() WHERE id = ${leadId}`);
    await insertMessage({ conversationId: convId, role: 'user', body: 'oke saya ambil 20 rim yang 64 gsm', createdAt: minutesAgo(10) });
    answer({ lead_kind: 'lead' }, [1]);
    expect(await runLeadInsightsPass(1, only())).toBe(1);
    expect((await getDb().select().from(leads).where(eq(leads.id, leadId)))[0]!.totalOrders).toBe(7);
    const { rows } = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM lead_orders WHERE lead_id = ${leadId}`);
    expect(rows[0]!.n).toBe(1);
  });

  // A repeat buyer's chat, all orders and invoices, can be labelled status_pesanan.
  it('keeps a customer who places orders a lead, even when the chat reads as an order follow-up', async () => {
    await insertMessage({ conversationId: convId, role: 'user', body: 'Pesan box nasi 20x20 = 2500 pcs', createdAt: minutesAgo(30) });
    await insertMessage({ conversationId: convId, role: 'user', body: 'invoice bulan ini sudah ada?', createdAt: minutesAgo(20) });
    answer({ lead_kind: 'status_pesanan' }, [1]);
    expect(await runLeadInsightsPass(1, only())).toBe(1);
    const [row] = await getDb().select().from(leads).where(eq(leads.id, leadId));
    expect(row).toMatchObject({ kind: 'lead', totalOrders: 1 });
  });

  it('never counts orders for a courier', async () => {
    await insertMessage({ conversationId: convId, role: 'user', body: 'saya grab mau ambil pesanan atas nama Budi 2 paket', createdAt: minutesAgo(10) });
    answer({ lead_kind: 'kurir' }, [1]);
    expect(await runLeadInsightsPass(1, only())).toBe(1);
    expect((await getDb().select().from(leads).where(eq(leads.id, leadId)))[0]!.totalOrders).toBe(0);
  });

  it('fills Hot/Cold, name and business for a chat the bot never answered', async () => {
    await insertMessage({ conversationId: convId, role: 'user', body: 'Saya Budi dari Toko Delima, box makanan 20x20 ada?', createdAt: minutesAgo(10) });
    answer({ lead_temperature: 'hot', name: 'Budi', business_name: 'Toko Delima' });

    await runLeadInsightsPass(1, only());

    const profile = await getContactProfile(contactId);
    expect(profile?.profile).toMatchObject({ name: 'Budi', business_name: 'Toko Delima' });
    const [lead] = await getDb().select().from(leads).where(eq(leads.contactId, contactId));
    expect(lead?.leadTemperature).toBe('hot');
  });

  // The live bot read these with the whole catalog in view, mid-conversation. A second opinion
  // after the fact only fills gaps.
  it('never overwrites what the live bot already wrote, but fills a blank value', async () => {
    await upsertContactProfile(contactId, { profilePatch: { name: 'Budi', business_name: '' } });
    await insertMessage({ conversationId: convId, role: 'user', body: 'dari Toko Delima', createdAt: minutesAgo(10) });
    answer({ name: 'Andi', business_name: 'Toko Delima' });

    await runLeadInsightsPass(1, only());

    expect((await getContactProfile(contactId))?.profile).toMatchObject({ name: 'Budi', business_name: 'Toko Delima' });
  });

  it('leaves the lead with both brands and two items after a chat about paper then boxes', async () => {
    await insertMessage({ conversationId: convId, role: 'user', body: 'kertas supreme 30x30 10 rim, sama box 20x20 500 pcs', createdAt: minutesAgo(10) });
    answer({
      lead_kind: 'lead',
      brands: ['kertas_supreme', 'imperial_indopack', 'brand_lain'],
      items: [
        { product: 'Kertas Supreme 64 gsm', size: '30x30', qty: 10, qty_unit: 'rim' },
        { product: 'Box makanan', size: '20x20', qty: '500', qty_unit: 'pcs' },
      ],
    });

    await runLeadInsightsPass(1, only());

    const lead = await theLead();
    expect([...lead.brands].sort()).toEqual(['imperial_indopack', 'kertas_supreme']);
    expect(lead.items).toHaveLength(2);
    expect(lead.items[1]).toMatchObject({ product: 'Box makanan', qty: 500, qty_unit: 'pcs' });
  });

  it('adds to what the lead has: a second pass keeps the old items and updates a matching one', async () => {
    await getDb().execute(sql`UPDATE leads SET brands = '{kertas_supreme}', items = '[{"product":"Kertas Supreme 64 gsm","size":"30x30","qty":5,"qty_unit":"rim"}]'::jsonb WHERE id = ${leadId}`);
    await insertMessage({ conversationId: convId, role: 'user', body: 'jadi 10 rim, plus box', createdAt: minutesAgo(10) });
    answer({
      lead_kind: 'lead', brands: ['imperial_indopack'],
      items: [{ product: 'Kertas Supreme 64 gsm', size: '30 x 30', qty: 10 }, { product: 'Box makanan', size: '20x20' }],
    });

    await runLeadInsightsPass(1, only());

    const lead = await theLead();
    expect([...lead.brands].sort()).toEqual(['imperial_indopack', 'kertas_supreme']);
    expect(lead.items).toHaveLength(2);
    expect(lead.items[0]).toMatchObject({ product: 'Kertas Supreme 64 gsm', qty: 10, qty_unit: 'rim' });
  });

  it('does not write brands or items to a lead the model calls a courier', async () => {
    await insertMessage({ conversationId: convId, role: 'user', body: 'saya kurir, ambil paket box', createdAt: minutesAgo(10) });
    answer({ lead_kind: 'kurir', brands: ['imperial_indopack'], items: [{ product: 'Box' }] });

    await runLeadInsightsPass(1, only());

    const lead = await theLead();
    expect(lead.brands).toEqual([]);
    expect(lead.items).toEqual([]);
  });

  it('writes nothing for a chat that is not a sale, and does not read it again', async () => {
    await insertMessage({ conversationId: convId, role: 'user', body: 'kamu gimana sayang', createdAt: minutesAgo(10) });
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: '{"is_sales_conversation": false, "lead_temperature": "hot"}' }], usage: {} });

    await runLeadInsightsPass(1, only());

    expect(await getContactProfile(contactId)).toBeNull();
    const [lead] = await getDb().select().from(leads).where(eq(leads.contactId, contactId));
    expect(lead?.leadTemperature).toBeNull();
    expect(await isDue()).toBe(false);
  });

  it('leaves the chat due when the model call itself fails', async () => {
    await insertMessage({ conversationId: convId, role: 'user', body: 'harga kertas supreme?', createdAt: minutesAgo(10) });
    mockCreate.mockRejectedValue(new Error('429 rate limited'));

    expect(await runLeadInsightsPass(1, only())).toBe(0);
    expect(await isDue()).toBe(true);
  });

  // --- CRM stages: the model proposes, the code checks ---
  const theLead = async () => (await getDb().select().from(leads).where(eq(leads.id, leadId)))[0]!;

  it('marks won with the matching customer message as proof', async () => {
    await insertMessage({ conversationId: convId, role: 'user', body: 'harga kertas supreme 30x30?', createdAt: minutesAgo(30) });
    const said = await insertMessage({ conversationId: convId, role: 'user', body: 'Oke saya ambil 10 rim, kirim nomor rekeningnya', createdAt: minutesAgo(20) });
    answer({ lead_kind: 'lead', stage: 'won', evidence: 'oke saya ambil 10 rim, kirim nomor rekeningnya' });

    await runLeadInsightsPass(1, only());

    const lead = await theLead();
    expect(lead.status).toBe('won');
    expect(lead.outcomeMessageId).toBe(said.id);
  });

  it("drops won when the evidence is the bot's own words", async () => {
    await insertMessage({ conversationId: convId, role: 'user', body: 'mau tanya kertas supreme', createdAt: minutesAgo(30) });
    await insertMessage({ conversationId: convId, role: 'assistant', body: 'Baik, pesanan 10 rim kami proses ya kak', createdAt: minutesAgo(20) });
    answer({ lead_kind: 'lead', stage: 'won', evidence: 'Baik, pesanan 10 rim kami proses ya kak' });

    await runLeadInsightsPass(1, only());

    expect((await theLead()).status).not.toBe('won');
  });

  it('drops won when the evidence is not in the chat', async () => {
    await insertMessage({ conversationId: convId, role: 'user', body: 'mau tanya kertas supreme', createdAt: minutesAgo(20) });
    answer({ lead_kind: 'lead', stage: 'won', evidence: 'deal, saya beli semuanya' });

    await runLeadInsightsPass(1, only());

    expect((await theLead()).status).not.toBe('won');
  });

  it('sets quoted from an outbound Rp figure without the model saying so', async () => {
    await insertMessage({ conversationId: convId, role: 'user', body: 'harga box nasi 20x20?', createdAt: minutesAgo(30) });
    await insertMessage({ conversationId: convId, role: 'assistant', body: 'Box nasi 20x20 Rp 1.800/pcs', createdAt: minutesAgo(20) });
    answer({ lead_kind: 'lead' });

    await runLeadInsightsPass(1, only());

    expect((await theLead()).status).toBe('quoted');
  });

  it('tags a courier chat and leaves it out of the lead counts', async () => {
    await insertMessage({ conversationId: convId, role: 'user', body: 'saya kurir grab, mau ambil paket', createdAt: minutesAgo(20) });
    answer({ is_sales_conversation: false, lead_kind: 'kurir' });

    await runLeadInsightsPass(1, only());

    const lead = await theLead();
    expect(lead.kind).toBe('kurir');
    expect(lead.kindSetBy).toBe('ai');
    expect(lead.status).toBe('new');
  });

  async function loseLead(closedMinutesAgo: number) {
    await getDb().execute(sql`UPDATE leads SET status = 'lost', lost_reason = 'barang_tidak_ada', closed_at = ${minutesAgo(closedMinutesAgo).toISOString()}::timestamptz WHERE id = ${leadId}`);
  }

  it('does not reopen a lost lead on "ok makasih"', async () => {
    await insertMessage({ conversationId: convId, role: 'user', body: 'ada gelas plastik?', createdAt: minutesAgo(60) });
    await insertMessage({ conversationId: convId, role: 'assistant', body: 'belum ada di kami kak', createdAt: minutesAgo(55) });
    await loseLead(50);
    await insertMessage({ conversationId: convId, role: 'user', body: 'ok makasih', createdAt: minutesAgo(10) });
    answer({ lead_kind: 'lead', stage: null });

    await runLeadInsightsPass(1, only());

    expect((await theLead()).status).toBe('lost');
  });

  it('reopens a lost lead when the customer wants something again, from the post-close messages only', async () => {
    await insertMessage({ conversationId: convId, role: 'user', body: 'ada gelas plastik?', createdAt: minutesAgo(60) });
    await insertMessage({ conversationId: convId, role: 'assistant', body: 'belum ada di kami kak', createdAt: minutesAgo(55) });
    await loseLead(50);
    await insertMessage({ conversationId: convId, role: 'user', body: 'kalau box nasi ada?', createdAt: minutesAgo(10) });
    answer({ lead_kind: 'lead', stage: 'contacted' });

    await runLeadInsightsPass(1, only());

    // The transcript sent to the model lacks the pre-close refusal.
    const sent = mockCreate.mock.calls[0]![0].messages[0].content as string;
    expect(sent).toContain('kalau box nasi ada?');
    expect(sent).not.toContain('belum ada di kami');
    const lead = await theLead();
    expect(lead.status).toBe('contacted');
    expect(lead.closedAt).toBeNull();
  });

  // Client, 2026-11-13: a lead closed for no response (closeSilentLeads) is never reopened - whoever
  // writes after it is a new lead, inside the reopen window too, and a bare greeting is enough.
  it.each([
    ['a greeting the model leaves at stage null', 'halo kak', null],
    ['a new need', 'kalau box nasi ada?', 'contacted'],
  ])('renews a lead closed for no response on %s', async (_name, body, stage) => {
    await insertMessage({ conversationId: convId, role: 'user', body: 'ada box kue?', createdAt: minutesAgo(60) });
    await insertMessage({ conversationId: convId, role: 'assistant', body: 'ada kak, untuk kue apa?', createdAt: minutesAgo(55) });
    await getDb().execute(sql`UPDATE leads SET status = 'lost', lost_reason = 'tidak_ada_respon', closed_at = ${minutesAgo(50).toISOString()}::timestamptz WHERE id = ${leadId}`);
    await insertMessage({ conversationId: convId, role: 'user', body, createdAt: minutesAgo(10) });
    answer({ lead_kind: 'lead', stage });

    await runLeadInsightsPass(1, only());

    const old = await theLead();
    expect(old.status).toBe('lost');
    expect(old.lostReason).toBe('tidak_ada_respon');
    const [renewal] = await getDb().select().from(leads).where(eq(leads.previousLeadId, leadId));
    expect(renewal?.status).toBe('contacted');
  });

  it('keeps a lead closed for no response Lost when the customer writes back to say no', async () => {
    await insertMessage({ conversationId: convId, role: 'user', body: 'ada box kue?', createdAt: minutesAgo(60) });
    await insertMessage({ conversationId: convId, role: 'assistant', body: 'ada kak', createdAt: minutesAgo(55) });
    await getDb().execute(sql`UPDATE leads SET status = 'lost', lost_reason = 'tidak_ada_respon', closed_at = ${minutesAgo(50).toISOString()}::timestamptz WHERE id = ${leadId}`);
    await insertMessage({ conversationId: convId, role: 'user', body: 'ga jadi kak, sudah beli', createdAt: minutesAgo(10) });
    answer({ lead_kind: 'lead', stage: 'lost', evidence: 'ga jadi kak, sudah beli', lost_reason: 'beli_di_tempat_lain' });

    await runLeadInsightsPass(1, only());

    const [renewal] = await getDb().select().from(leads).where(eq(leads.previousLeadId, leadId));
    expect(renewal).toBeUndefined();
  });

  // A Lost call can quote a customer message that did not close the chat.
  it('does not take the customer\'s own opening question as proof of Lost', async () => {
    await insertMessage({ conversationId: convId, role: 'user', body: 'apa ada jual gelas plastik ya?', createdAt: minutesAgo(30) });
    await insertMessage({ conversationId: convId, role: 'assistant', body: 'Gelas plastik belum ada di kami ya', createdAt: minutesAgo(29) });
    answer({ lead_kind: 'lead', stage: 'lost', evidence: 'apa ada jual gelas plastik ya?', lost_reason: 'barang_tidak_ada' });

    await runLeadInsightsPass(1, only());

    expect((await theLead()).status).not.toBe('lost');
  });

  it('does not take a "Baik kk" the customer kept talking after as proof of Lost', async () => {
    await insertMessage({ conversationId: convId, role: 'user', body: 'Styrofoam 20x20 berapa', createdAt: minutesAgo(30) });
    await insertMessage({ conversationId: convId, role: 'assistant', body: 'Mohon maaf, styrofoam belum ada di kami ya', createdAt: minutesAgo(29) });
    await insertMessage({ conversationId: convId, role: 'user', body: 'Baik kk', createdAt: minutesAgo(28) });
    await insertMessage({ conversationId: convId, role: 'assistant', body: 'Boleh tahu nama kakak?', createdAt: minutesAgo(27) });
    await insertMessage({ conversationId: convId, role: 'user', body: 'Saya Bang Andi dari Sidoarjo, buat katering', createdAt: minutesAgo(26) });
    answer({ lead_kind: 'lead', stage: 'lost', evidence: 'Baik kk', lost_reason: 'barang_tidak_ada' });

    await runLeadInsightsPass(1, only());

    expect((await theLead()).status).not.toBe('lost');
  });

  it('still takes a sign-off after our "belum ada" as Lost, with a thank-you after it', async () => {
    await insertMessage({ conversationId: convId, role: 'user', body: 'ada gelas plastik?', createdAt: minutesAgo(30) });
    await insertMessage({ conversationId: convId, role: 'assistant', body: 'belum ada di kami kak', createdAt: minutesAgo(29) });
    await insertMessage({ conversationId: convId, role: 'user', body: 'oh gitu ya, ga jadi deh kak', createdAt: minutesAgo(28) });
    await insertMessage({ conversationId: convId, role: 'user', body: 'makasih kak', createdAt: minutesAgo(27) });
    answer({ lead_kind: 'lead', stage: 'lost', evidence: 'ga jadi deh kak', lost_reason: 'barang_tidak_ada' });

    await runLeadInsightsPass(1, only());

    const lead = await theLead();
    expect(lead.status).toBe('lost');
    expect(lead.outcomeEvidence).toBe('oh gitu ya, ga jadi deh kak');
  });

  // Task 13 carry: the order-fields step read the lead from before this pass wrote Lost, and merged.
  it('adds no brands or items to a lead this very pass closed as Lost', async () => {
    await insertMessage({ conversationId: convId, role: 'user', body: 'ada box ukuran 60x60x40?', createdAt: minutesAgo(30) });
    await insertMessage({ conversationId: convId, role: 'assistant', body: 'belum ada di kami kak', createdAt: minutesAgo(29) });
    await insertMessage({ conversationId: convId, role: 'user', body: 'oh gitu ya, ga jadi deh kak', createdAt: minutesAgo(28) });
    answer({
      lead_kind: 'lead', stage: 'lost', evidence: 'ga jadi deh kak', lost_reason: 'barang_tidak_ada',
      brands: ['imperial_indopack'], items: [{ product: 'Box', size: '60x60x40' }],
    });

    await runLeadInsightsPass(1, only());

    const lead = await theLead();
    expect(lead.status).toBe('lost');
    expect(lead.brands).toEqual([]);
    expect(lead.items).toEqual([]);
  });

  // Repeat buyers with verified orders must not come out with no stage at all.
  it('takes a repeat buyer filed as status_pesanan as Won, proven by the latest order', async () => {
    await insertMessage({ conversationId: convId, role: 'user', body: 'Pesan kertas supreme 30x30 = 5 rim', createdAt: minutesAgo(40) });
    await insertMessage({ conversationId: convId, role: 'assistant', body: 'siap kak dicatat', createdAt: minutesAgo(39) });
    const last = await insertMessage({ conversationId: convId, role: 'user', body: 'Pesan box kue 20x20 = 1000 pcs', createdAt: minutesAgo(20) });
    await insertMessage({ conversationId: convId, role: 'user', body: 'sudah transfer ya kak', createdAt: minutesAgo(10) });
    answer({ lead_kind: 'status_pesanan', stage: null }, [1, 2]);

    await runLeadInsightsPass(1, only());

    const lead = await theLead();
    expect(lead.kind).toBe('lead');
    expect(lead.status).toBe('won');
    expect(lead.outcomeMessageId).toBe(last.id);
  });

  it('writes nothing for kind/stage when LEAD_STAGE_AI=0', async () => {
    process.env['LEAD_STAGE_AI'] = '0';
    await insertMessage({ conversationId: convId, role: 'user', body: 'oke saya ambil 10 rim', createdAt: minutesAgo(20) });
    await insertMessage({ conversationId: convId, role: 'assistant', body: 'Rp 46.000/Lsn', createdAt: minutesAgo(19) });
    // A sale (kind 'lead'), so the fills still go on; the non-lead kind case is the next test.
    answer({ lead_kind: 'lead', stage: 'won', evidence: 'oke saya ambil 10 rim', lead_temperature: 'hot' });

    await runLeadInsightsPass(1, only());

    const lead = await theLead();
    expect(lead.kind).toBe('lead');
    expect(lead.status).toBe('new');
    expect(lead.leadTemperature).toBe('hot');
  });

  it('still treats a non-lead kind as not a sale when LEAD_STAGE_AI=0', async () => {
    process.env['LEAD_STAGE_AI'] = '0';
    await insertMessage({ conversationId: convId, role: 'user', body: 'mau melamar kerja, ada lowongan admin gudang?', createdAt: minutesAgo(20) });
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({
        lead_kind: 'lamaran_kerja', name: 'Budi', lead_temperature: 'hot',
      }) }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    await runLeadInsightsPass(1, only());

    expect(await getContactProfile(contactId)).toBeNull();
    const lead = await theLead();
    expect(lead.kind).toBe('lead'); // the kind write itself stays off
    expect(lead.leadTemperature).toBeNull();
  });

  it.each(['won', 'quoted'])('keeps the AI off the kind of a %s lead', async (status) => {
    await getDb().execute(sql`UPDATE leads SET status = ${status} WHERE id = ${leadId}`);
    await insertMessage({ conversationId: convId, role: 'user', body: 'sudah transfer, kapan dikirim?', createdAt: minutesAgo(10) });
    answer({ lead_kind: 'status_pesanan' });

    await runLeadInsightsPass(1, only());

    const lead = await theLead();
    expect(lead.kind).toBe('lead');
    expect(lead.status).toBe(status);
  });

  // The prompt no longer asks is_sales_conversation, so these answers carry only lead_kind.
  const kindAnswer = (fields: Record<string, unknown>) => mockCreate.mockResolvedValue({
    content: [{ type: 'text', text: JSON.stringify(fields) }],
    usage: { input_tokens: 1, output_tokens: 1 },
  });

  it.each(['quoted', 'won'])('keeps the fills of a %s buyer the model labels status_pesanan', async (status) => {
    await getDb().execute(sql`UPDATE leads SET status = ${status} WHERE id = ${leadId}`);
    await insertMessage({ conversationId: convId, role: 'user', body: 'sudah transfer ya kak, box nasi 2500 pcs kapan dikirim?', createdAt: minutesAgo(10) });
    kindAnswer({ lead_kind: 'status_pesanan', lead_temperature: 'hot', name: 'Budi', business_name: 'Toko Delima' });

    await runLeadInsightsPass(1, only());

    const lead = await theLead();
    expect(lead).toMatchObject({ kind: 'lead', status, leadTemperature: 'hot' });
    expect((await getContactProfile(contactId))?.profile).toMatchObject({ name: 'Budi', business_name: 'Toko Delima' });
  });

  it('keeps the fills when staff set the kind to lead and the model labels it status_pesanan', async () => {
    await getDb().execute(sql`UPDATE leads SET kind_set_by = 'staff' WHERE id = ${leadId}`);
    await insertMessage({ conversationId: convId, role: 'user', body: 'pesanan box nasi kemarin sudah dikirim?', createdAt: minutesAgo(10) });
    kindAnswer({ lead_kind: 'status_pesanan', lead_temperature: 'hot', name: 'Budi' });

    await runLeadInsightsPass(1, only());

    expect(await theLead()).toMatchObject({ kind: 'lead', kindSetBy: 'staff', leadTemperature: 'hot' });
    expect((await getContactProfile(contactId))?.profile).toMatchObject({ name: 'Budi' });
  });

  it('still skips the fills of a new lead the model calls a courier, and tags it', async () => {
    await insertMessage({ conversationId: convId, role: 'user', body: 'saya kurir grab, mau ambil paket', createdAt: minutesAgo(10) });
    kindAnswer({ lead_kind: 'kurir', lead_temperature: 'hot', name: 'Budi' });

    await runLeadInsightsPass(1, only());

    expect(await theLead()).toMatchObject({ kind: 'kurir', kindSetBy: 'ai', leadTemperature: null });
    expect(await getContactProfile(contactId)).toBeNull();
  });

  it('cuts a Lost lead with no closed_at at updated_at', async () => {
    await insertMessage({ conversationId: convId, role: 'user', body: 'ada gelas plastik?', createdAt: minutesAgo(130) });
    await insertMessage({ conversationId: convId, role: 'assistant', body: 'belum ada di kami kak', createdAt: minutesAgo(125) });
    await getDb().execute(sql`UPDATE leads SET status = 'lost', closed_at = NULL, updated_at = ${minutesAgo(60).toISOString()}::timestamptz WHERE id = ${leadId}`);
    await insertMessage({ conversationId: convId, role: 'user', body: 'kalau box nasi ada?', createdAt: minutesAgo(10) });
    answer({ lead_kind: 'lead', stage: 'contacted' });

    await runLeadInsightsPass(1, only());

    const sent = mockCreate.mock.calls[0]![0].messages[0].content as string;
    expect(sent).toContain('kalau box nasi ada?');
    expect(sent).not.toContain('belum ada di kami');
  });
  it('dry run reports the would-be won and writes nothing', async () => {
    await insertMessage({ conversationId: convId, role: 'user', body: 'harga kertas supreme 30x30?', createdAt: minutesAgo(30) });
    await insertMessage({ conversationId: convId, role: 'user', body: 'Oke saya ambil 10 rim, kirim nomor rekeningnya', createdAt: minutesAgo(20) });
    answer({ lead_kind: 'lead', stage: 'won', evidence: 'oke saya ambil 10 rim, kirim nomor rekeningnya', lead_temperature: 'hot' });
    const eventCount = async () => (await getDb().execute<{ n: string }>(sql`SELECT count(*) AS n FROM lead_events WHERE lead_id = ${leadId}`)).rows[0]!.n;
    const before = await eventCount();
    const results: { conversationId: string; wouldChange: string[] }[] = [];

    const n = await runLeadInsightsPass(1, { ...only(), dryRun: true, ignoreWatermark: true, onResult: (r) => results.push(r) });

    expect(n).toBe(1);
    expect(results).toHaveLength(1);
    expect(results[0]!.conversationId).toBe(convId);
    expect(results[0]!.wouldChange.join(' | ')).toMatch(/status new->won/);
    const lead = await theLead();
    expect(lead.status).toBe('new');
    expect(lead.leadTemperature).toBeNull();
    expect(await eventCount()).toBe(before);
    expect(await isDue()).toBe(true); // watermark untouched
  });

  it('skips a staff-locked lead without calling the model when skipStaff is set', async () => {
    await insertMessage({ conversationId: convId, role: 'user', body: 'harga kertas supreme 30x30?', createdAt: minutesAgo(30) });
    await getDb().execute(sql`UPDATE leads SET kind_set_by = 'staff' WHERE id = ${leadId}`);
    answer({ lead_kind: 'lead', stage: 'contacted' });
    const skipped: string[] = [];

    await runLeadInsightsPass(1, { ...only(), dryRun: true, ignoreWatermark: true, skipStaff: true, onSkip: (s) => skipped.push(s.reason) });

    expect(skipped).toEqual(['staff']);
    expect(mockCreate).not.toHaveBeenCalled();
  });
  it('never stamps the watermark later than now, even with a future since', async () => {
    await insertMessage({ conversationId: convId, role: 'user', body: 'harga kertas supreme 30x30?', createdAt: minutesAgo(30) });
    answer({ lead_kind: 'lead', stage: 'contacted' });
    const future = new Date(Date.now() + 365 * 86_400_000);

    await runLeadInsightsPass(1, { ...only(), ignoreWatermark: true, since: future });

    const [row] = (await getDb().execute<{ t: Date | null }>(sql`SELECT insights_extracted_at AS t FROM conversations WHERE id = ${convId}`)).rows;
    // Stamped at all (a NULL stamp would read as epoch 0 and pass the comparison below).
    expect(row!.t).not.toBeNull();
    expect(new Date(row!.t!).getTime()).toBeLessThanOrEqual(Date.now());
  });

  // --- the history reads in the order things happened ---
  // Each event as the detail page lists it, with its time and its message's time as microsecond text.
  const history = async (id = leadId) => (await getDb().execute<{
    from_status: string | null; to_status: string | null; message_id: string | null; at: string; msg_at: string | null;
  }>(sql`
    SELECT e.from_status, e.to_status, e.message_id, to_char(e.created_at, 'YYYY-MM-DD HH24:MI:SS.US') AS at,
           to_char(m.created_at, 'YYYY-MM-DD HH24:MI:SS.US') AS msg_at
    FROM lead_events e LEFT JOIN messages m ON m.id = e.message_id
    WHERE e.lead_id = ${id}
    ORDER BY e.created_at, CASE e.to_status WHEN 'new' THEN 0 WHEN 'contacted' THEN 1 WHEN 'quoted' THEN 2 ELSE 3 END, e.id`)).rows;
  // A send time with microseconds, which a JS Date cannot carry.
  const addMicros = (id: string) => getDb().execute(sql`UPDATE messages SET created_at = created_at + interval '123 microseconds' WHERE id = ${id}`);

  it('dates Penawaran and Menang by their own messages, in that order, in one pass', async () => {
    await getDb().execute(sql`DELETE FROM lead_events WHERE lead_id = ${leadId}`);
    await insertMessage({ conversationId: convId, role: 'user', body: 'harga box nasi 20x20?', createdAt: minutesAgo(40) });
    const firstQuote = await insertMessage({ conversationId: convId, role: 'assistant', body: 'Box nasi 20x20 Rp 1.800/pcs', createdAt: minutesAgo(35) });
    await insertMessage({ conversationId: convId, role: 'assistant', body: 'Yang Victor Rp 52.000/Lsn', createdAt: minutesAgo(30) });
    const said = await insertMessage({ conversationId: convId, role: 'user', body: 'oke saya ambil 2500 pcs box nasinya', createdAt: minutesAgo(20) });
    await insertMessage({ conversationId: convId, role: 'assistant', body: 'Total 2 x Rp 46.000 = Rp 92.000', createdAt: minutesAgo(15) });
    await addMicros(firstQuote.id);
    await addMicros(said.id);
    answer({ lead_kind: 'lead', stage: 'won', evidence: 'oke saya ambil 2500 pcs box nasinya' });

    await runLeadInsightsPass(1, only());

    const ev = await history();
    expect(ev.map((e) => `${e.from_status}->${e.to_status}`)).toEqual(['new->quoted', 'quoted->won']);
    // The FIRST quote, not the newest and not the one after the "saya ambil".
    expect(ev[0]!.message_id).toBe(firstQuote.id);
    expect(ev[1]!.message_id).toBe(said.id);
    for (const e of ev) expect(e.at).toBe(e.msg_at);
    expect(ev[1]!.at).toMatch(/\.\d{3}123$/);
    const { rows } = await getDb().execute<{ same: boolean }>(sql`
      SELECT l.closed_at = m.created_at AS same FROM leads l JOIN messages m ON m.id = l.outcome_message_id WHERE l.id = ${leadId}`);
    expect(rows[0]?.same).toBe(true);
  });

  it('writes no Penawaran when the only quote came after the outcome', async () => {
    await getDb().execute(sql`DELETE FROM lead_events WHERE lead_id = ${leadId}`);
    const said = await insertMessage({ conversationId: convId, role: 'user', body: 'saya ambil box nasi 2500 pcs', createdAt: minutesAgo(20) });
    await insertMessage({ conversationId: convId, role: 'assistant', body: 'Total Rp 92.000 ya kak', createdAt: minutesAgo(15) });
    answer({ lead_kind: 'lead', stage: 'won', evidence: 'saya ambil box nasi 2500 pcs' });

    await runLeadInsightsPass(1, only());

    const ev = await history();
    expect(ev.map((e) => `${e.from_status}->${e.to_status}`)).toEqual(['new->won']);
    expect(ev[0]!.message_id).toBe(said.id);
  });

  it('a returning customer reads reopen -> Penawaran -> Menang, each at its message', async () => {
    await getDb().execute(sql`DELETE FROM lead_events WHERE lead_id = ${leadId}`);
    await insertMessage({ conversationId: convId, role: 'user', body: 'ada gelas plastik?', createdAt: minutesAgo(60) });
    await loseLead(50);
    // A quote the bot sent after the close but before the customer came back belongs to no step.
    await insertMessage({ conversationId: convId, role: 'assistant', body: 'Kalau paper bag kraft Rp 85.000/pack kak', createdAt: minutesAgo(45) });
    const back = await insertMessage({ conversationId: convId, role: 'user', body: 'kalau box nasi ada?', createdAt: minutesAgo(30) });
    const quote = await insertMessage({ conversationId: convId, role: 'assistant', body: 'Box nasi 20x20 Rp 1.800/pcs', createdAt: minutesAgo(25) });
    const said = await insertMessage({ conversationId: convId, role: 'user', body: 'oke saya ambil 2500 pcs box nasinya', createdAt: minutesAgo(20) });
    answer({ lead_kind: 'lead', stage: 'won', evidence: 'oke saya ambil 2500 pcs box nasinya' });

    await runLeadInsightsPass(1, only());

    const ev = await history();
    expect(ev.map((e) => `${e.from_status}->${e.to_status}`)).toEqual(['lost->contacted', 'contacted->quoted', 'quoted->won']);
    expect(ev.map((e) => e.message_id)).toEqual([back.id, quote.id, said.id]);
    for (const e of ev) expect(e.at).toBe(e.msg_at);
  });

  it("keeps a Lost lead's own refusal out of the post-close transcript to the microsecond", async () => {
    await insertMessage({ conversationId: convId, role: 'user', body: 'ada gelas plastik?', createdAt: minutesAgo(60) });
    const refusal = await insertMessage({ conversationId: convId, role: 'user', body: 'ga jadi deh kak, kemahalan', createdAt: minutesAgo(50) });
    await addMicros(refusal.id);
    // Closed exactly at the refusal, as applyLeadStage dates it.
    await getDb().execute(sql`UPDATE leads SET status = 'lost', lost_reason = 'harga',
      closed_at = (SELECT created_at FROM messages WHERE id = ${refusal.id}) WHERE id = ${leadId}`);
    await insertMessage({ conversationId: convId, role: 'user', body: 'kalau box nasi ada?', createdAt: minutesAgo(10) });
    answer({ lead_kind: 'lead', stage: 'contacted' });

    await runLeadInsightsPass(1, only());

    const sent = mockCreate.mock.calls[0]![0].messages[0].content as string;
    expect(sent).toContain('kalau box nasi ada?');
    expect(sent).not.toContain('kemahalan');
  });

  it('a reopened lead on its next pass takes no Penawaran from the lifecycle that ended Lost', async () => {
    await insertMessage({ conversationId: convId, role: 'user', body: 'harga paper bag kraft?', createdAt: minutesAgo(60) });
    await insertMessage({ conversationId: convId, role: 'assistant', body: 'Paper bag kraft Rp 85.000/pack kak', createdAt: minutesAgo(55) });
    const refusal = await insertMessage({ conversationId: convId, role: 'user', body: 'ga jadi kak, kemahalan', createdAt: minutesAgo(50) });
    await getDb().execute(sql`UPDATE leads SET status = 'lost', lost_reason = 'harga',
      closed_at = (SELECT created_at FROM messages WHERE id = ${refusal.id}) WHERE id = ${leadId}`);
    await insertMessage({ conversationId: convId, role: 'user', body: 'kalau box nasi ada?', createdAt: minutesAgo(20) });
    answer({ lead_kind: 'lead', stage: 'contacted' });
    await runLeadInsightsPass(1, only());
    expect((await theLead()).status).toBe('contacted');

    // Pass 2 reads the whole chat again (the lead is open now), old quote included.
    await insertMessage({ conversationId: convId, role: 'user', body: 'yang warna hitam ya', createdAt: minutesAgo(10) });
    answer({ lead_kind: 'lead', stage: 'contacted' });
    await runLeadInsightsPass(1, only());

    expect((await theLead()).status).toBe('contacted');
    expect((await history()).map((e) => `${e.from_status}->${e.to_status}`)).toEqual(['lost->contacted']);
  });

  it('reopens at the message that brought them back, so a quote before "nanti saya kabari" counts', async () => {
    await insertMessage({ conversationId: convId, role: 'user', body: 'ada gelas plastik?', createdAt: minutesAgo(60) });
    await loseLead(50);
    const back = await insertMessage({ conversationId: convId, role: 'user', body: 'box nasi ada?', createdAt: minutesAgo(30) });
    const quoted = await insertMessage({ conversationId: convId, role: 'assistant', body: 'Box nasi 20x20 Rp 1.800/pcs', createdAt: minutesAgo(25) });
    await insertMessage({ conversationId: convId, role: 'user', body: 'oke nanti saya kabari', createdAt: minutesAgo(20) });
    answer({ lead_kind: 'lead', stage: 'contacted' });

    await runLeadInsightsPass(1, only());

    const ev = await history();
    expect(ev.map((e) => `${e.from_status}->${e.to_status}`)).toEqual(['lost->contacted', 'contacted->quoted']);
    expect(ev.map((e) => e.message_id)).toEqual([back.id, quoted.id]);
    for (const e of ev) expect(e.at).toBe(e.msg_at);
  });

  // --- a return is the first customer message no pass has read ---
  const DAY = 86_400_000;
  const at = (ms: number) => new Date(ms);
  /** Lost on a refusal, then the "makasih" right after it - read by a pass that leaves the lead Lost. */
  async function closeThenSignOff(baseMs: number, opts: { staff?: boolean } = {}) {
    await insertMessage({ conversationId: convId, role: 'user', body: 'ada gelas plastik?', createdAt: at(baseMs - 120_000) });
    await insertMessage({ conversationId: convId, role: 'assistant', body: 'belum ada di kami kak', createdAt: at(baseMs - 60_000) });
    const refusal = await insertMessage({ conversationId: convId, role: 'user', body: 'oh ya udah kak ga jadi', createdAt: at(baseMs) });
    await getDb().execute(sql`UPDATE leads SET status = 'lost', lost_reason = 'barang_tidak_ada',
      closed_at = (SELECT created_at FROM messages WHERE id = ${refusal.id}),
      human_updated_at = ${opts.staff ? sql`now()` : sql`NULL`} WHERE id = ${leadId}`);
    const thanks = await insertMessage({ conversationId: convId, role: 'user', body: 'ok kak makasih', createdAt: at(baseMs + 120_000) });
    answer({ lead_kind: 'lead', stage: null });
    await runLeadInsightsPass(1, only());
    expect((await theLead()).status).toBe('lost');
    const { rows } = await getDb().execute<{ read: boolean }>(sql`
      SELECT c.insights_extracted_at >= date_trunc('milliseconds', m.created_at) AS read
      FROM conversations c, messages m WHERE c.id = ${convId} AND m.id = ${thanks.id}`);
    expect(rows[0]?.read).toBe(true); // the watermark sits on the makasih
  }
  const renewalOf = async () => (await getDb().select().from(leads).where(sql`${leads.previousLeadId} = ${leadId}`))[0];

  it('renews a customer back months after the close, though a "makasih" followed the refusal', async () => {
    const windowDays = await getLeadReopenAfterDays();
    const gap = (windowDays + 30) * DAY;
    const baseMs = Date.now() - gap - DAY;
    await closeThenSignOff(baseMs);
    const back = await insertMessage({ conversationId: convId, role: 'user', body: 'ada box nasi 20x20?', createdAt: at(baseMs + gap) });
    answer({ lead_kind: 'lead', stage: 'contacted' });

    await runLeadInsightsPass(1, only());

    expect((await theLead()).status).toBe('lost'); // not reopened at the makasih
    const renewed = await renewalOf();
    expect(renewed).toBeDefined();
    const { rows } = await getDb().execute<{ ok: boolean }>(sql`
      SELECT l.submitted_at = m.created_at AND l.first_contact_at = m.created_at AS ok
      FROM leads l, messages m WHERE l.id = ${renewed!.id} AND m.id = ${back.id}`);
    expect(rows[0]?.ok).toBe(true);
    expect((await history(renewed!.id)).map((e) => e.message_id)).toEqual([back.id]);
  });

  it('renews a staff-closed lead the same way, instead of staying "closed inside the window" forever', async () => {
    const windowDays = await getLeadReopenAfterDays();
    const gap = (windowDays + 30) * DAY;
    const baseMs = Date.now() - gap - DAY;
    await closeThenSignOff(baseMs, { staff: true });
    await insertMessage({ conversationId: convId, role: 'user', body: 'ada box nasi 20x20?', createdAt: at(baseMs + gap) });
    answer({ lead_kind: 'lead', stage: 'contacted' });

    await runLeadInsightsPass(1, only());

    const old = await theLead();
    expect(old.status).toBe('lost');
    expect(old.humanUpdatedAt).not.toBeNull();
    expect((await renewalOf())?.status).toBe('contacted');
  });

  it('still reopens a return inside the window, dated at the return message', async () => {
    const baseMs = Date.now() - 10 * DAY;
    await closeThenSignOff(baseMs);
    const back = await insertMessage({ conversationId: convId, role: 'user', body: 'kalau box nasi 20x20 ada?', createdAt: at(baseMs + 3 * DAY) });
    answer({ lead_kind: 'lead', stage: 'contacted' });

    await runLeadInsightsPass(1, only());

    expect((await theLead()).status).toBe('contacted');
    expect(await renewalOf()).toBeUndefined();
    const ev = await history();
    expect(ev.map((e) => `${e.from_status}->${e.to_status}`)).toEqual(['lost->contacted']);
    expect(ev[0]!.message_id).toBe(back.id);
    expect(ev[0]!.at).toBe(ev[0]!.msg_at);
  });
});
