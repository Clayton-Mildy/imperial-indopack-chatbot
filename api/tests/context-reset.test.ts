/**
 * context-reset.test.ts
 *
 * /new stamps conversations.context_reset_at and the AI stops seeing anything at or below it,
 * while the dashboard keeps the whole thread. Two things are worth guarding, and nothing else:
 *
 *  1. The floor is on exactly the three AI-facing readers and NOT on the dashboard's. Flooring
 *     the count but not getMessagesForSummary would write pre-reset history straight back into
 *     conversation_summary - the reset silently undoing itself.
 *  2. A summarization job that started before the reset must not land after it. Same failure,
 *     reached by a race instead of a missing WHERE.
 *
 * The floor IS SQL, so this runs against real Postgres - a mocked repository would only test
 * the mock. Same TEST_PREFIX fixture idiom as leads.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import 'dotenv/config';

// Stubbed because getConfig() memoizes, so the whitelist tests below could not vary it. Safe
// for the DB half: db/client.ts reads process.env['DATABASE_URL'] directly, not getConfig.
// Same idiom as staff-notify.test.ts. Declared ABOVE the imports on purpose - vitest hoists
// the vi.mock call but not `cfg`, so a module calling getConfig() at import time would hit the
// temporal dead zone if this sat further down.
let cfg: Record<string, string> = {};
vi.mock('../src/config.js', () => ({ getConfig: () => cfg }));
import { sql } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { contacts, phoneNumbers } from '../src/db/schema.js';
import {
  upsertConversation,
  insertMessage,
  getLastNMessages,
  getConversationMessages,
  countConversationMessages,
  getMessagesForSummary,
  updateConversationSummary,
  resetConversationContext,
  findConversationById,
} from '../src/repositories/conversations.js';
import { isResetCommand, isResetAllowed } from '../src/services/messageRouter.js';

const TEST_PREFIX = '__ctxreset_test__';

describe('context reset', () => {
  let convId: string;
  let contactId: string;

  async function cleanup() {
    const db = getDb();
    await db.execute(sql`
      DELETE FROM messages WHERE conversation_id IN (
        SELECT c.id FROM conversations c
        JOIN contacts ct ON ct.id = c.contact_id
        WHERE ct.wa_id LIKE ${`${TEST_PREFIX}%`}
      )
    `);
    await db.execute(sql`
      DELETE FROM conversations WHERE contact_id IN (
        SELECT id FROM contacts WHERE wa_id LIKE ${`${TEST_PREFIX}%`}
      )
    `);
    await db.execute(sql`DELETE FROM contacts WHERE wa_id LIKE ${`${TEST_PREFIX}%`}`);
    await db.execute(sql`DELETE FROM phone_numbers WHERE number LIKE ${`${TEST_PREFIX}%`}`);
  }

  beforeAll(async () => {
    await cleanup();
    const db = getDb();
    const [contact] = await db.insert(contacts).values({ waId: `${TEST_PREFIX}a` }).returning();
    const [number] = await db
      .insert(phoneNumbers)
      .values({ number: `${TEST_PREFIX}n`, wabaId: 'test', phoneNumberId: 'test' })
      .returning();
    contactId = contact!.id;
    const conv = await upsertConversation(contactId, number!.id);
    convId = conv.id;
  });

  // upsertConversation never makes a second conversation for a (contact, number) pair, so the
  // tests share one row and rewind it instead.
  beforeEach(async () => {
    const db = getDb();
    await db.execute(sql`DELETE FROM messages WHERE conversation_id = ${convId}`);
    await db.execute(sql`
      UPDATE conversations SET context_reset_at = NULL, conversation_summary = NULL
      WHERE id = ${convId}
    `);
  });

  afterAll(cleanup);

  it('floors the AI readers at the reset, and only the AI readers', async () => {
    for (const b of ['a', 'b', 'c']) {
      await insertMessage({ conversationId: convId, role: 'user', body: b });
    }
    await resetConversationContext(convId);
    await insertMessage({ conversationId: convId, role: 'user', body: 'after' });

    expect((await getLastNMessages(convId, 20)).map((m) => m.body)).toEqual(['after']);
    expect(await countConversationMessages(convId)).toBe(1);
    // Bodies, not a row count: summarizeCount derives from the floored count above, so an
    // unfloored SELECT here still returns ONE row - just the wrong one, message 'a'. A length
    // assertion passes while pre-reset history goes into the summary. Ask what it returned.
    expect((await getMessagesForSummary(convId, 0)).map((m) => m.body)).toEqual(['after']);
    // The dashboard keeps everything - the customer's history is still auditable.
    expect((await getConversationMessages(convId)).map((m) => m.body)).toEqual(['a', 'b', 'c', 'after']);
  });

  // /new passes its own WhatsApp send time. Inbound rows carry theirs too, so a message typed a
  // second after the command stays above the floor even if it was saved before the reset ran.
  it('floors at the given time, keeping a message sent a second after it', async () => {
    const at = new Date(Date.now() - 60_000);
    await insertMessage({ conversationId: convId, role: 'user', body: 'before', createdAt: new Date(at.getTime() - 1000) });
    await insertMessage({ conversationId: convId, role: 'user', body: 'after', createdAt: new Date(at.getTime() + 1000) });
    await resetConversationContext(convId, at);

    expect((await getLastNMessages(convId, 20)).map((m) => m.body)).toEqual(['after']);
  });

  // What maybeSummarizeConversation now passes: the oldest summarized row, not the job start.
  it('does not write a summary whose oldest row sits under the floor', async () => {
    const at = new Date(Date.now() - 60_000);
    const oldest = new Date(at.getTime() - 5000);
    await resetConversationContext(convId, at);
    await updateConversationSummary(convId, 'pre-reset summary', oldest);
    expect((await findConversationById(convId))?.conversationSummary).toBeNull();
  });

  it('clears the summary, which no floor could hide', async () => {
    await updateConversationSummary(convId, 'pembeli katering, sudah ditawar 90.000', new Date());
    await resetConversationContext(convId);
    expect((await findConversationById(convId))?.conversationSummary).toBeNull();
  });

  it('does not write a summary computed before the reset', async () => {
    const startedAt = new Date();
    await resetConversationContext(convId);
    await updateConversationSummary(convId, 'stale pre-reset summary', startedAt);
    expect((await findConversationById(convId))?.conversationSummary).toBeNull();
  });

  // The gate that decides who may destroy a contact's profile and lead status. A stray
  // includes() or a missing whitelist check here means an ordinary customer wipes their own
  // record by typing one word.
  describe('the /new gate', () => {
    it('matches only the bare command', () => {
      expect(isResetCommand('/new')).toBe(true);
      expect(isResetCommand('  /NEW  ')).toBe(true);
      expect(isResetCommand('kak tolong /new dong')).toBe(false);
      expect(isResetCommand('ada yang new gak?')).toBe(false);
      expect(isResetCommand('/newsletter')).toBe(false);
    });

    it('refuses everyone when the whitelist is empty', () => {
      cfg = { RESET_COMMAND_NUMBERS: '' };
      expect(isResetAllowed('628123456789')).toBe(false);
    });

    it('allows only listed numbers, comparing digits only', () => {
      cfg = { RESET_COMMAND_NUMBERS: '+62 812-3456-789, 628999888777' };
      expect(isResetAllowed('628123456789')).toBe(true);
      expect(isResetAllowed('62812-3456-789')).toBe(true);
      expect(isResetAllowed('628999888777@s.whatsapp.net')).toBe(true);
      expect(isResetAllowed('628111222333')).toBe(false);
    });
  });

  it('leaves an un-reset conversation completely alone', async () => {
    for (const b of ['a', 'b']) {
      await insertMessage({ conversationId: convId, role: 'user', body: b });
    }
    expect((await getLastNMessages(convId, 20)).map((m) => m.body)).toEqual(['a', 'b']);
    expect(await countConversationMessages(convId)).toBe(2);
  });
});

describe('hasUnlinkedAssistantTwin', () => {
  const PREFIX = '__twin_test__';
  let convId: string;

  beforeAll(async () => {
    const db = getDb();
    await db.execute(sql`DELETE FROM messages WHERE conversation_id IN (SELECT c.id FROM conversations c JOIN contacts ct ON ct.id = c.contact_id WHERE ct.wa_id LIKE ${`${PREFIX}%`})`);
    await db.execute(sql`DELETE FROM conversations WHERE contact_id IN (SELECT id FROM contacts WHERE wa_id LIKE ${`${PREFIX}%`})`);
    await db.execute(sql`DELETE FROM contacts WHERE wa_id LIKE ${`${PREFIX}%`}`);
    await db.execute(sql`DELETE FROM phone_numbers WHERE number LIKE ${`${PREFIX}%`}`);
    const [contact] = await db.insert(contacts).values({ waId: `${PREFIX}a` }).returning();
    const [number] = await db.insert(phoneNumbers).values({ number: `${PREFIX}n`, wabaId: 'test', phoneNumberId: 'test' }).returning();
    convId = (await upsertConversation(contact!.id, number!.id)).id;
  });

  afterAll(async () => {
    const db = getDb();
    await db.execute(sql`DELETE FROM messages WHERE conversation_id = ${convId}`);
    await db.execute(sql`DELETE FROM conversations WHERE id = ${convId}`);
    await db.execute(sql`DELETE FROM contacts WHERE wa_id LIKE ${`${PREFIX}%`}`);
    await db.execute(sql`DELETE FROM phone_numbers WHERE number LIKE ${`${PREFIX}%`}`);
  });

  // chakraSync asks this before importing an outbound text as a staff reply: a bot reply whose send
  // threw after WhatsApp accepted it is stored with no wamid, and must not come back as "Tim CS".
  it('finds a bot reply stored without its wamid, and only that', async () => {
    const { hasUnlinkedAssistantTwin } = await import('../src/repositories/conversations.js');
    const at = new Date();
    await insertMessage({ conversationId: convId, role: 'assistant', body: 'Siap kak', status: 'saved', createdAt: at });
    await insertMessage({ conversationId: convId, role: 'assistant', body: 'Linked', waMessageId: `${PREFIX}wamid`, createdAt: at });

    expect(await hasUnlinkedAssistantTwin(convId, 'Siap kak', new Date(at.getTime() + 60_000))).toBe(true);
    expect(await hasUnlinkedAssistantTwin(convId, 'Siap kak', new Date(at.getTime() + 30 * 60_000))).toBe(false);
    expect(await hasUnlinkedAssistantTwin(convId, 'Linked', at)).toBe(false);
    expect(await hasUnlinkedAssistantTwin(convId, 'mohon maaf kami tidak menyediakan', at)).toBe(false);
  });
});
