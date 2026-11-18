/**
 * lead-apply-stage.test.ts - applyLeadStage, lead_events, the current-lead rule and reopen/renew.
 * Needs DATABASE_URL.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import 'dotenv/config';
import { eq, sql, type SQL } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { contacts, leads, phoneNumbers, staffProfiles } from '../src/db/schema.js';
import { upsertConversation, insertMessage } from '../src/repositories/conversations.js';
import {
  applyLeadStage,
  findCurrentLeadForContact,
  reopenOrRenewLostLead,
  patchLead,
  ensureOrganicLead,
  applyAiLeadUpdate,
  LEAD_ALREADY_OPEN,
} from '../src/repositories/leads.js';
import { listLeadEvents } from '../src/repositories/leadEvents.js';
import { getLeadReopenAfterDays, setLeadReopenAfterDays } from '../src/repositories/appSettings.js';

const P = '__leadstage_test__';

describe('lead stage writes', () => {
  let contactId: string;
  let messageId: string;
  let oldMessageId: string;
  let oldMessageAt: Date;
  let staffId: string;
  let leadId: string;
  let convId: string;

  async function cleanup() {
    const db = getDb();
    const mine = sql`(SELECT id FROM contacts WHERE wa_id LIKE ${`${P}%`})`;
    await db.execute(sql`DELETE FROM lead_events WHERE lead_id IN (SELECT id FROM leads WHERE contact_id IN ${mine})`);
    await db.execute(sql`UPDATE leads SET previous_lead_id = NULL WHERE contact_id IN ${mine}`);
    await db.execute(sql`DELETE FROM leads WHERE contact_id IN ${mine}`);
    await db.execute(sql`DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE contact_id IN ${mine})`);
    await db.execute(sql`DELETE FROM conversations WHERE contact_id IN ${mine}`);
    await db.execute(sql`DELETE FROM contacts WHERE wa_id LIKE ${`${P}%`}`);
    await db.execute(sql`DELETE FROM phone_numbers WHERE number LIKE ${`${P}%`}`);
    await db.execute(sql`DELETE FROM staff_profiles WHERE email LIKE ${`${P}%`}`);
  }

  // Test helper: the raw row.
  const getLead = async (id: string) => {
    const [row] = await getDb().select().from(leads).where(eq(leads.id, id));
    return row!;
  };
  const newLead = async (values: Partial<typeof leads.$inferInsert> = {}) => {
    const [row] = await getDb().insert(leads).values({ contactId, ...values }).returning();
    return row!;
  };
  const wipeLeads = async () => {
    await getDb().execute(sql`UPDATE leads SET previous_lead_id = NULL WHERE contact_id = ${contactId}`);
    await getDb().execute(sql`DELETE FROM leads WHERE contact_id = ${contactId}`);
  };

  beforeAll(async () => {
    await cleanup();
    const db = getDb();
    const [c] = await db.insert(contacts).values({ waId: `${P}a` }).returning();
    contactId = c!.id;
    const [n] = await db.insert(phoneNumbers).values({ number: `${P}n`, wabaId: 'test', phoneNumberId: 'test' }).returning();
    const conv = await upsertConversation(contactId, n!.id);
    convId = conv.id;
    const msg = await insertMessage({ conversationId: conv.id, role: 'user', body: 'saya ambil' });
    messageId = msg.id;
    const old = await insertMessage({
      conversationId: conv.id,
      role: 'user',
      body: 'oke saya ambil 10 rim',
      createdAt: new Date(Date.now() - 40 * 86_400_000),
    });
    oldMessageId = old.id;
    oldMessageAt = old.createdAt;
    const [s] = await db.insert(staffProfiles).values({ email: `${P}@example.test`, passwordHash: 'x', name: 'T' }).returning();
    staffId = s!.id;
  });
  beforeEach(async () => {
    await wipeLeads();
    leadId = (await newLead()).id;
  });
  afterAll(cleanup);

  it('advances and records an event', async () => {
    expect(await applyLeadStage(leadId, { status: 'contacted', actor: 'ai', evidence: 'ada box?' })).toBe(true);
    const ev = await listLeadEvents(leadId);
    expect(ev.at(-1)).toMatchObject({ fromStatus: 'new', toStatus: 'contacted', actor: 'ai', evidence: 'ada box?' });
  });

  it('never moves backwards and never touches won', async () => {
    await applyLeadStage(leadId, { status: 'won', actor: 'ai', evidence: 'saya ambil', messageId });
    expect(await applyLeadStage(leadId, { status: 'lost', actor: 'ai', lostReason: 'harga' })).toBe(false);
    const l = await getLead(leadId);
    expect(l.status).toBe('won');
    expect(l.closedAt).not.toBeNull();
    expect(l.outcomeEvidence).toBe('saya ambil');
    expect(l.outcomeMessageId).toBe(messageId);
    expect(l.lostReason).toBeNull();
  });

  it('dates an outcome by its evidence message, not the run day', async () => {
    await applyLeadStage(leadId, { status: 'won', actor: 'ai', evidence: 'saya ambil 10 rim', messageId: oldMessageId });
    const l = await getLead(leadId);
    expect(l.closedAt?.getTime()).toBe(oldMessageAt.getTime());
    const won = (await listLeadEvents(leadId)).find((e) => e.toStatus === 'won');
    expect(won?.createdAt.getTime()).toBe(oldMessageAt.getTime());
  });

  it('dates an outcome without a message now', async () => {
    const t0 = Date.now();
    await applyLeadStage(leadId, { status: 'lost', actor: 'ai', lostReason: 'harga' });
    expect((await getLead(leadId)).closedAt!.getTime()).toBeGreaterThanOrEqual(t0 - 1000);
  });

  it('records lost reason on lost', async () => {
    await applyLeadStage(leadId, { status: 'lost', actor: 'ai', lostReason: 'harga', evidence: 'mahal' });
    const l = await getLead(leadId);
    expect(l.lostReason).toBe('harga');
    expect(l.closedAt).not.toBeNull();
  });

  it('leaves status alone after a staff edit, and kind alone after staff set it', async () => {
    await patchLead(leadId, { status: 'quoted', staffId });
    await patchLead(leadId, { kind: 'lead', staffId });
    expect(await applyLeadStage(leadId, { status: 'won', kind: 'kurir', kindSetBy: 'ai', actor: 'ai' })).toBe(false);
    const l = await getLead(leadId);
    expect(l).toMatchObject({ status: 'quoted', kind: 'lead', kindSetBy: 'staff' });
    // The kind patch changed nothing (lead -> lead), so only the status edit is in history.
    expect((await listLeadEvents(leadId)).map((e) => e.actor)).toEqual(['staff']);
  });

  it('writes a kind change and an event', async () => {
    expect(await applyLeadStage(leadId, { kind: 'kurir', kindSetBy: 'rule', actor: 'system' })).toBe(true);
    expect(await getLead(leadId)).toMatchObject({ kind: 'kurir', kindSetBy: 'rule' });
    expect((await listLeadEvents(leadId)).at(-1)).toMatchObject({ fromKind: 'lead', toKind: 'kurir', actor: 'system' });
  });

  it('patchLead status writes a staff event and manages closed_at', async () => {
    await patchLead(leadId, { status: 'won', staffId });
    expect((await getLead(leadId)).closedAt).not.toBeNull();
    expect((await listLeadEvents(leadId)).at(-1)).toMatchObject({ toStatus: 'won', actor: 'staff', staffId });
    await patchLead(leadId, { status: 'contacted', staffId });
    expect((await getLead(leadId)).closedAt).toBeNull();
  });

  it('a staff status change clears the AI outcome it replaces', async () => {
    await applyLeadStage(leadId, { status: 'won', actor: 'ai', evidence: 'saya ambil 10 rim', messageId: oldMessageId });
    const t0 = Date.now();
    await patchLead(leadId, { status: 'lost', staffId });
    let l = await getLead(leadId);
    expect(l).toMatchObject({ status: 'lost', outcomeEvidence: null, outcomeMessageId: null, lostReason: null });
    expect(l.closedAt!.getTime()).toBeGreaterThanOrEqual(t0 - 1000);

    await patchLead(leadId, { status: 'won', staffId });
    await patchLead(leadId, { status: 'lost', lostReason: 'harga', staffId });
    l = await getLead(leadId);
    expect(l.lostReason).toBe('harga');

    await patchLead(leadId, { status: 'quoted', staffId });
    l = await getLead(leadId);
    expect(l).toMatchObject({ closedAt: null, lostReason: null, outcomeEvidence: null });
  });

  it('refuses to reopen an old lost organic lead while another is open', async () => {
    await wipeLeads();
    const old = await newLead({ status: 'lost', lostReason: 'harga', submittedAt: new Date('2026-08-01T00:00:00Z') });
    await newLead({ status: 'contacted', previousLeadId: old.id });
    const before = await getLead(old.id);
    expect(await patchLead(old.id, { status: 'contacted', staffId })).toBe(LEAD_ALREADY_OPEN);
    expect(await getLead(old.id)).toEqual(before);
    expect(await listLeadEvents(old.id)).toHaveLength(0);
  });

  it('current lead = newest non-lost (two campaign leads + one lost organic)', async () => {
    await wipeLeads();
    const lost = await newLead({ status: 'lost', submittedAt: new Date('2026-10-30T00:00:00Z') });
    const c1 = await newLead({ requestId: crypto.randomUUID(), submittedAt: new Date('2026-09-01T00:00:00Z') });
    const c2 = await newLead({ requestId: crypto.randomUUID(), submittedAt: new Date('2026-10-01T00:00:00Z') });
    expect((await findCurrentLeadForContact(contactId))?.id).toBe(c2.id);
    await getDb().update(leads).set({ status: 'lost' }).where(eq(leads.id, c2.id));
    expect((await findCurrentLeadForContact(contactId))?.id).toBe(c1.id);
    await getDb().update(leads).set({ status: 'lost' }).where(eq(leads.id, c1.id));
    expect((await findCurrentLeadForContact(contactId))?.id).toBe(lost.id);
    expect(await findCurrentLeadForContact('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('applyAiLeadUpdate targets the same current lead', async () => {
    await wipeLeads();
    const open = await newLead({ submittedAt: new Date('2026-09-01T00:00:00Z') });
    const lost = await newLead({ requestId: crypto.randomUUID(), status: 'lost', submittedAt: new Date('2026-10-01T00:00:00Z') });
    await applyAiLeadUpdate(contactId, { temperature: 'hot' });
    expect((await getLead(open.id)).leadTemperature).toBe('hot');
    expect((await getLead(lost.id)).leadTemperature).toBeNull();
  });

  it('reopens inside the window, renews after it', async () => {
    const daysAgo = (n: number) => sql`now() - make_interval(days => ${n})`;
    await getDb().execute(sql`UPDATE leads SET status = 'lost', lost_reason = 'harga', outcome_evidence = 'x', closed_at = ${daysAgo(10)} WHERE id = ${leadId}`);
    const evidence = { body: 'masih ada box tadi?', messageId };
    const reopened = await reopenOrRenewLostLead((await findCurrentLeadForContact(contactId))!, 30, evidence);
    expect(reopened.id).toBe(leadId);
    expect(reopened).toMatchObject({ status: 'contacted', closedAt: null, lostReason: null, outcomeEvidence: null });
    expect((await listLeadEvents(leadId)).at(-1)).toMatchObject({
      fromStatus: 'lost',
      toStatus: 'contacted',
      actor: 'ai',
      evidence: evidence.body,
      messageId,
    });

    await getDb().execute(sql`UPDATE leads SET status = 'lost', closed_at = ${daysAgo(40)} WHERE id = ${leadId}`);
    const renewed = await reopenOrRenewLostLead((await findCurrentLeadForContact(contactId))!, 30, evidence);
    expect(renewed.id).not.toBe(leadId);
    expect(renewed).toMatchObject({ previousLeadId: leadId, status: 'contacted', kind: 'lead' });
    expect(renewed.firstContactAt).not.toBeNull();
    expect((await listLeadEvents(renewed.id)).at(-1)).toMatchObject({ toStatus: 'contacted', messageId });
    expect((await findCurrentLeadForContact(contactId))?.id).toBe(renewed.id);
  });

  it('does not reopen a staff-closed lead inside the window', async () => {
    await patchLead(leadId, { status: 'lost', staffId });
    await getDb().execute(sql`UPDATE leads SET closed_at = now() - make_interval(days => 10) WHERE id = ${leadId}`);
    const lead = (await findCurrentLeadForContact(contactId))!;
    const out = await reopenOrRenewLostLead(lead, 30, { body: 'halo', messageId });
    expect(out.id).toBe(leadId);
    expect(out.status).toBe('lost');
    const n = await getDb().execute(sql`SELECT count(*)::int AS n FROM leads WHERE contact_id = ${contactId}`);
    expect(n.rows[0]!['n']).toBe(1);
  });

  it('renews a staff-closed lead after the window, leaving the old one untouched', async () => {
    await patchLead(leadId, { status: 'lost', staffId });
    await getDb().execute(sql`UPDATE leads SET closed_at = now() - make_interval(days => 40) WHERE id = ${leadId}`);
    const before = await getLead(leadId);
    const out = await reopenOrRenewLostLead((await findCurrentLeadForContact(contactId))!, 30, { body: 'halo', messageId });
    expect(out.id).not.toBe(leadId);
    expect(out).toMatchObject({ previousLeadId: leadId, status: 'contacted' });
    expect(out.firstContactAt).not.toBeNull();
    const after = await getLead(leadId);
    expect(after.status).toBe('lost');
    expect(after.humanUpdatedAt).toEqual(before.humanUpdatedAt);
    expect((await listLeadEvents(out.id)).at(-1)).toMatchObject({ toStatus: 'contacted', messageId });
  });

  // --- a returning customer's lifecycle is dated by its messages ---
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
  const sameInstant = async (a: SQL, b: SQL) =>
    (await getDb().execute<{ same: boolean }>(sql`SELECT ${a} = ${b} AS same`)).rows[0]!.same;

  it('measures the reopen window from the close to the return message, not to now', async () => {
    const back = await insertMessage({ conversationId: convId, role: 'user', body: 'box nasi yang kemarin masih ada?', createdAt: daysAgo(10) });
    // Closed exactly 30 days before the return message - 40 days before now.
    await getDb().execute(sql`UPDATE leads SET status = 'lost', lost_reason = 'harga',
      closed_at = (SELECT created_at - interval '30 days' FROM messages WHERE id = ${back.id}) WHERE id = ${leadId}`);
    const out = await reopenOrRenewLostLead((await findCurrentLeadForContact(contactId))!, 30, { body: back.body, messageId: back.id });
    expect(out.id).toBe(leadId); // inclusive, like the old rule
    expect(out.status).toBe('contacted');

    // One second past the window renews.
    await getDb().execute(sql`UPDATE leads SET status = 'lost',
      closed_at = (SELECT created_at - interval '30 days 1 second' FROM messages WHERE id = ${back.id}) WHERE id = ${leadId}`);
    const renewed = await reopenOrRenewLostLead((await findCurrentLeadForContact(contactId))!, 30, { body: back.body, messageId: back.id });
    expect(renewed.id).not.toBe(leadId);
  });

  it('starts a backfilled renewal at the return message, so time to close is never negative', async () => {
    await getDb().execute(sql`UPDATE leads SET status = 'lost', lost_reason = 'harga', closed_at = now() - interval '60 days' WHERE id = ${leadId}`);
    const back = await insertMessage({ conversationId: convId, role: 'user', body: 'mau order box nasi lagi kak', createdAt: daysAgo(20) });
    const said = await insertMessage({ conversationId: convId, role: 'user', body: 'oke saya ambil 5 rim', createdAt: daysAgo(19) });
    const renewed = await reopenOrRenewLostLead((await findCurrentLeadForContact(contactId))!, 30, { body: back.body, messageId: back.id });
    expect(renewed.id).not.toBe(leadId);
    const msgAt = sql`(SELECT created_at FROM messages WHERE id = ${back.id})`;
    for (const col of ['submitted_at', 'matched_at', 'first_contact_at']) {
      expect(await sameInstant(sql`(SELECT ${sql.identifier(col)} FROM leads WHERE id = ${renewed.id})`, msgAt)).toBe(true);
    }
    const ev = (await listLeadEvents(renewed.id)).at(-1)!;
    expect(ev).toMatchObject({ fromStatus: null, toStatus: 'contacted', messageId: back.id });
    expect(ev.createdAt.getTime()).toBe(back.createdAt.getTime());

    await applyLeadStage(renewed.id, { status: 'won', actor: 'ai', evidence: said.body, messageId: said.id });
    const { rows } = await getDb().execute<{ secs: number }>(sql`
      SELECT extract(epoch FROM closed_at - coalesce(first_contact_at, matched_at, submitted_at))::float AS secs FROM leads WHERE id = ${renewed.id}`);
    expect(rows[0]!.secs).toBeGreaterThanOrEqual(0);
  });

  it('dates an organic lead\'s creation event by its first message', async () => {
    await wipeLeads();
    const at = daysAgo(3);
    await ensureOrganicLead(contactId, at);
    const [row] = await getDb().select().from(leads).where(eq(leads.contactId, contactId));
    expect(row!.firstContactAt?.getTime()).toBe(at.getTime());
    const ev = await listLeadEvents(row!.id);
    expect(ev[0]).toMatchObject({ toStatus: 'new', actor: 'system' });
    expect(ev[0]!.createdAt.getTime()).toBe(at.getTime());
  });

  it('ensureOrganicLead writes first_contact_at and a system event only on insert', async () => {
    await wipeLeads();
    await ensureOrganicLead(contactId, new Date());
    await ensureOrganicLead(contactId, new Date());
    const rows = await getDb().select().from(leads).where(eq(leads.contactId, contactId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.firstContactAt).not.toBeNull();
    const ev = await listLeadEvents(rows[0]!.id);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ fromStatus: null, toStatus: 'new', actor: 'system' });
  });

  it('reopen window setting: set and validate', async () => {
    const before = await getLeadReopenAfterDays();
    try {
      await setLeadReopenAfterDays(45);
      expect(await getLeadReopenAfterDays()).toBe(45);
      await expect(setLeadReopenAfterDays(0)).rejects.toThrow();
      await expect(setLeadReopenAfterDays(366)).rejects.toThrow();
      await expect(setLeadReopenAfterDays(1.5)).rejects.toThrow();
    } finally {
      await setLeadReopenAfterDays(before);
    }
  });
});
