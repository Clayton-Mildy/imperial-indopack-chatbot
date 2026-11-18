/**
 * lead-silence.test.ts - closeSilentLeads: no customer reply to our last message within the threshold
 * closes the lead as Lost (tidak_ada_respon). Needs DATABASE_URL. Scoped to its own contacts: the
 * local DB is a production restore and the sweep must not close real rows.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import 'dotenv/config';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { contacts, conversations, leads, phoneNumbers } from '../src/db/schema.js';
import { CANNED_DESIGN_EXAMPLES_FROM_TEAM, CANNED_PO_FORM_FROM_TEAM, poFormMessage } from '../src/domain/constants.js';
import { upsertConversation, insertMessage } from '../src/repositories/conversations.js';
import { closeSilentLeads } from '../src/repositories/leads.js';
import { listLeadEvents } from '../src/repositories/leadEvents.js';

const P = '__leadsilence_test__';
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

async function cleanup() {
  const db = getDb();
  const mine = sql`(SELECT id FROM contacts WHERE wa_id LIKE ${`${P}%`})`;
  await db.execute(sql`DELETE FROM lead_events WHERE lead_id IN (SELECT id FROM leads WHERE contact_id IN ${mine})`);
  await db.execute(sql`DELETE FROM leads WHERE contact_id IN ${mine}`);
  await db.execute(sql`DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE contact_id IN ${mine})`);
  await db.execute(sql`DELETE FROM conversations WHERE contact_id IN ${mine}`);
  await db.execute(sql`DELETE FROM contacts WHERE wa_id LIKE ${`${P}%`}`);
  await db.execute(sql`DELETE FROM phone_numbers WHERE number LIKE ${`${P}%`}`);
}

let phoneId: string;
const contactIds: string[] = [];

/** A contact, its chat (customer first, then the given rows) and an open lead. */
async function chat(
  name: string,
  rows: { role: 'user' | 'assistant' | 'system'; daysAgo: number; source?: string; body?: string }[],
  lead: Partial<typeof leads.$inferInsert> = {},
  convStatus?: string
) {
  const db = getDb();
  const [c] = await db.insert(contacts).values({ waId: `${P}${name}` }).returning();
  contactIds.push(c!.id);
  const conv = await upsertConversation(c!.id, phoneId);
  if (convStatus) await db.update(conversations).set({ status: convStatus }).where(eq(conversations.id, conv.id));
  let last = new Date(0);
  for (const r of rows) {
    const m = await insertMessage({
      conversationId: conv.id, role: r.role, body: r.body ?? `${r.role} ${r.daysAgo}`, createdAt: ago(r.daysAgo),
      ...(r.source ? { metadata: { source: r.source } } : {}),
    });
    if (r.role !== 'system') last = m.createdAt;
  }
  const [l] = await db.insert(leads).values({ contactId: c!.id, status: 'contacted', ...lead }).returning();
  return { leadId: l!.id, last };
}

const getLead = async (id: string) => (await getDb().select().from(leads).where(eq(leads.id, id)))[0]!;

describe('closeSilentLeads', () => {
  beforeAll(async () => {
    await cleanup();
    const [n] = await getDb().insert(phoneNumbers).values({ number: `${P}n`, wabaId: 'test', phoneNumberId: 'test' }).returning();
    phoneId = n!.id;
  });
  afterAll(cleanup);

  it('closes a lead whose customer never answered our last message, dated when the threshold passed', async () => {
    const { leadId, last } = await chat('silent', [{ role: 'user', daysAgo: 21 }, { role: 'assistant', daysAgo: 20 }]);
    const closed = await closeSilentLeads(14, { contactIds });
    expect(closed.map((c) => c.leadId)).toContain(leadId);
    const row = await getLead(leadId);
    expect(row.status).toBe('lost');
    expect(row.lostReason).toBe('tidak_ada_respon');
    expect(row.closedAt!.getTime()).toBe(last.getTime() + 14 * DAY);
    const [event] = (await listLeadEvents(leadId)).filter((e) => e.toStatus === 'lost');
    expect(event!.actor).toBe('system');
    expect(event!.createdAt.getTime()).toBe(row.closedAt!.getTime());
  });

  it('counts a staff reply from the phone as ours, and ignores a later system note', async () => {
    const { leadId } = await chat('staff', [{ role: 'user', daysAgo: 30 }, { role: 'assistant', daysAgo: 25, source: 'chakra_sync' }, { role: 'system', daysAgo: 1 }]);
    await closeSilentLeads(14, { contactIds });
    expect((await getLead(leadId)).status).toBe('lost');
  });

  it.each([
    ['the customer wrote last - they are waiting on us', [{ role: 'assistant' as const, daysAgo: 21 }, { role: 'user' as const, daysAgo: 20 }], {}],
    ['our last message is inside the threshold', [{ role: 'user' as const, daysAgo: 6 }, { role: 'assistant' as const, daysAgo: 5 }], {}],
    ['our last message is a hand-off - waiting on the team', [{ role: 'user' as const, daysAgo: 21 }, { role: 'assistant' as const, daysAgo: 20, source: 'escalation_ack' }], {}],
    ['staff set the status', [{ role: 'user' as const, daysAgo: 21 }, { role: 'assistant' as const, daysAgo: 20 }], { humanUpdatedAt: new Date() }],
    ['the lead is Won', [{ role: 'user' as const, daysAgo: 21 }, { role: 'assistant' as const, daysAgo: 20 }], { status: 'won' as const }],
    ['it is not a lead', [{ role: 'user' as const, daysAgo: 21 }, { role: 'assistant' as const, daysAgo: 20 }], { kind: 'kurir' as const }],
  ])('leaves it alone when %s', async (name, rows, lead) => {
    const { leadId } = await chat(name.replace(/\W+/g, '_').slice(0, 30), rows, lead);
    const before = await getLead(leadId);
    const closed = await closeSilentLeads(14, { contactIds });
    expect(closed.map((c) => c.leadId)).not.toContain(leadId);
    expect((await getLead(leadId)).status).toBe(before.status);
  });

  // Final review M7: the team's promise lines (the PO form while its link is not set, the design
  // examples) are not the bot's last word - the customer is waiting on the team. Nor is a chat that is
  // escalated or taken over.
  it.each([
    ['our last message is the PO form the team will send', [{ role: 'user' as const, daysAgo: 21 }, { role: 'assistant' as const, daysAgo: 20.5 }, { role: 'assistant' as const, daysAgo: 20, source: 'po_form', body: CANNED_PO_FORM_FROM_TEAM }], undefined],
    ['our last message is the design examples the team will send', [{ role: 'user' as const, daysAgo: 21 }, { role: 'assistant' as const, daysAgo: 20, source: 'design_examples', body: CANNED_DESIGN_EXAMPLES_FROM_TEAM }], undefined],
    ['the chat is escalated', [{ role: 'user' as const, daysAgo: 21 }, { role: 'assistant' as const, daysAgo: 20 }], 'escalated'],
    ['a person took the chat over', [{ role: 'user' as const, daysAgo: 21 }, { role: 'assistant' as const, daysAgo: 20 }], 'needs_human'],
  ])('leaves it alone when %s', async (name, rows, convStatus) => {
    const { leadId } = await chat(name.replace(/\W+/g, '_').slice(0, 30), rows, {}, convStatus);
    const closed = await closeSilentLeads(14, { contactIds });
    expect(closed.map((c) => c.leadId)).not.toContain(leadId);
    expect((await getLead(leadId)).status).toBe('contacted');
  });

  it('still closes a lead whose customer got the PO form link itself and went quiet', async () => {
    const { leadId } = await chat('po_link', [{ role: 'user', daysAgo: 21 }, { role: 'assistant', daysAgo: 20, source: 'po_form', body: poFormMessage('https://forms.gle/ContohPO123') }]);
    await closeSilentLeads(14, { contactIds });
    expect((await getLead(leadId)).status).toBe('lost');
  });

  it('writes nothing on a dry run', async () => {
    const { leadId } = await chat('dry', [{ role: 'user', daysAgo: 40 }, { role: 'assistant', daysAgo: 39 }]);
    const would = await closeSilentLeads(14, { dryRun: true, contactIds });
    expect(would.map((c) => c.leadId)).toContain(leadId);
    expect((await getLead(leadId)).status).toBe('contacted');
    expect(await listLeadEvents(leadId)).toHaveLength(0);
  });
});
