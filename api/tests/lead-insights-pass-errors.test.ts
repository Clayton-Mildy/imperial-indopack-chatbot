/**
 * lead-insights-pass-errors.test.ts
 *
 * One chat whose writes throw must not stop the background lead pass at that chat every sweep:
 * the chats behind it still get their Tipe / Hot-Cold / Minat fills and are stamped, the failed
 * one is left due for the next sweep. A MODEL error still stops the sweep (rate limits).
 *
 * Needs DATABASE_URL. Scoped to this file's own conversations (`conversationIds`).
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

// The one writer that throws, and only for the contact under test; everyone else gets the real one.
const failFor = new Set<string>();
vi.mock('../src/repositories/contactProfiles.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/repositories/contactProfiles.js')>();
  return {
    ...orig,
    fillContactProfileGaps: vi.fn(async (contactId: string, patch: Parameters<typeof orig.fillContactProfileGaps>[1]) => {
      if (failFor.has(contactId)) throw new Error('boom on this chat');
      return orig.fillContactProfileGaps(contactId, patch);
    }),
  };
});

import { eq, sql } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { contacts, conversations, phoneNumbers, leads } from '../src/db/schema.js';
import { upsertConversation, insertMessage } from '../src/repositories/conversations.js';
import { getContactProfile, deleteContactProfile } from '../src/repositories/contactProfiles.js';
import { ensureOrganicLead } from '../src/repositories/leads.js';
import { runLeadInsightsPass } from '../src/services/leadInsights.js';

const TEST_PREFIX = '__leadinsights_err_test__';
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

const ANSWER = {
  content: [{ type: 'text', text: JSON.stringify({ lead_kind: 'lead', product_sought: 'Engsel tanam 3D', lead_temperature: 'hot' }) }],
  usage: { input_tokens: 1, output_tokens: 1 },
};

describe('lead-insights pass, one chat failing', () => {
  const chats: { contactId: string; convId: string }[] = [];

  async function cleanup() {
    const db = getDb();
    const mine = sql`(SELECT id FROM contacts WHERE wa_id LIKE ${`${TEST_PREFIX}%`})`;
    await db.execute(sql`DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE contact_id IN ${mine})`);
    await db.execute(sql`DELETE FROM conversations WHERE contact_id IN ${mine}`);
    await db.execute(sql`DELETE FROM lead_events WHERE lead_id IN (SELECT id FROM leads WHERE contact_id IN ${mine})`);
    await db.execute(sql`DELETE FROM leads WHERE contact_id IN ${mine}`);
    await db.execute(sql`DELETE FROM contact_profiles WHERE contact_id IN ${mine}`);
    await db.execute(sql`DELETE FROM contacts WHERE wa_id LIKE ${`${TEST_PREFIX}%`}`);
    await db.execute(sql`DELETE FROM phone_numbers WHERE number LIKE ${`${TEST_PREFIX}%`}`);
  }

  beforeAll(async () => {
    await cleanup();
    const db = getDb();
    const [number] = await db.insert(phoneNumbers).values({ number: `${TEST_PREFIX}n`, wabaId: 'test', phoneNumberId: 'test' }).returning();
    for (const suffix of ['a', 'b']) {
      const [contact] = await db.insert(contacts).values({ waId: `${TEST_PREFIX}${suffix}` }).returning();
      const convId = (await upsertConversation(contact!.id, number!.id)).id;
      await ensureOrganicLead(contact!.id, minutesAgo(60));
      chats.push({ contactId: contact!.id, convId });
    }
  });

  beforeEach(async () => {
    mockCreate.mockReset();
    failFor.clear();
    delete process.env['LEAD_STAGE_AI'];
    const db = getDb();
    for (const [i, c] of chats.entries()) {
      await db.execute(sql`DELETE FROM messages WHERE conversation_id = ${c.convId}`);
      await db.execute(sql`UPDATE conversations SET insights_extracted_at = NULL WHERE id = ${c.convId}`);
      await db.execute(sql`UPDATE leads SET lead_temperature = NULL WHERE contact_id = ${c.contactId}`);
      await deleteContactProfile(c.contactId);
      // The first chat is the newer one, so the sweep (newest first) reaches it first.
      await insertMessage({ conversationId: c.convId, role: 'user', body: 'ada engsel tanam 3D? mau order', createdAt: minutesAgo(10 + i * 5) });
    }
  });

  afterAll(cleanup);

  const ids = () => ({ conversationIds: chats.map((c) => c.convId) });
  const stamped = async (convId: string) =>
    (await getDb().select().from(conversations).where(eq(conversations.id, convId)))[0]!.insightsExtractedAt !== null;
  const temperature = async (contactId: string) =>
    (await getDb().select().from(leads).where(eq(leads.contactId, contactId)))[0]!.leadTemperature;

  it('goes on to the next chat when one chat\'s writes throw, and leaves the failed one due', async () => {
    const [first, second] = chats;
    failFor.add(first!.contactId);
    mockCreate.mockResolvedValue(ANSWER);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const read = await runLeadInsightsPass(2, ids());

    // One main read per chat (each sales chat also gets its order call, not counted here).
    const mainReads = mockCreate.mock.calls.filter(([req]) => !String((req as { system?: string }).system).includes('Setiap pesan Pelanggan diberi nomor'));
    expect(mainReads).toHaveLength(2);
    expect(read).toBe(1);
    expect(warn.mock.calls.map((c) => String(c[0]))).toContain(`[leadInsights] chat ${first!.convId} failed: boom on this chat`);
    warn.mockRestore();

    expect(await stamped(first!.convId)).toBe(false);
    expect(await stamped(second!.convId)).toBe(true);
    expect((await getContactProfile(second!.contactId))?.profile).toMatchObject({ product_sought: 'Engsel tanam 3D' });
    expect(await temperature(second!.contactId)).toBe('hot');

    // Retried next sweep, and read once the write works again.
    failFor.clear();
    expect(await runLeadInsightsPass(2, ids())).toBe(1);
    expect(await stamped(first!.convId)).toBe(true);
    expect((await getContactProfile(first!.contactId))?.profile).toMatchObject({ product_sought: 'Engsel tanam 3D' });
  });

  it('still stops the sweep on a model error, stamping nothing', async () => {
    mockCreate.mockRejectedValue(new Error('429 rate limited'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(await runLeadInsightsPass(2, ids())).toBe(0);
    warn.mockRestore();

    expect(mockCreate).toHaveBeenCalledTimes(1);
    for (const c of chats) expect(await stamped(c.convId)).toBe(false);
  });
});
