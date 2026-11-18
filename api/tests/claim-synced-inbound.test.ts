/**
 * claimSyncedInbound - the webhook's second chance when the wamid is already taken.
 *
 * chakraSync can store an inbound message before its webhook is handled, and it never answers
 * anything. The webhook used to read the taken wamid as "duplicate" and drop the message, so the
 * bot never answered it. Whether a taken wamid is the sync's row or the webhook's own, and that
 * two deliveries can never both take one row, is SQL - so this runs against real Postgres.
 * Same PREFIX fixture idiom as context-reset.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { contacts, phoneNumbers } from '../src/db/schema.js';
import {
  upsertConversation,
  insertMessageIfNew,
  claimSyncedInbound,
  findMessageByWaMessageId,
} from '../src/repositories/conversations.js';

const PREFIX = '__claim_synced_test__';

describe('claimSyncedInbound', () => {
  let convId: string;

  async function cleanup() {
    const db = getDb();
    await db.execute(sql`DELETE FROM messages WHERE conversation_id IN (SELECT c.id FROM conversations c JOIN contacts ct ON ct.id = c.contact_id WHERE ct.wa_id LIKE ${`${PREFIX}%`})`);
    await db.execute(sql`DELETE FROM conversations WHERE contact_id IN (SELECT id FROM contacts WHERE wa_id LIKE ${`${PREFIX}%`})`);
    await db.execute(sql`DELETE FROM contacts WHERE wa_id LIKE ${`${PREFIX}%`}`);
    await db.execute(sql`DELETE FROM phone_numbers WHERE number LIKE ${`${PREFIX}%`}`);
  }

  beforeAll(async () => {
    await cleanup();
    const db = getDb();
    const [contact] = await db.insert(contacts).values({ waId: `${PREFIX}a` }).returning();
    const [number] = await db.insert(phoneNumbers).values({ number: `${PREFIX}n`, wabaId: 'test', phoneNumberId: 'test' }).returning();
    convId = (await upsertConversation(contact!.id, number!.id)).id;
  });

  beforeEach(async () => {
    await getDb().execute(sql`DELETE FROM messages WHERE conversation_id = ${convId}`);
  });

  afterAll(cleanup);

  // What chakraSync.importMessage writes for an inbound photo.
  const syncRow = (wamid: string) => insertMessageIfNew({
    conversationId: convId,
    role: 'user',
    body: '[Foto]',
    waMessageId: wamid,
    metadata: { source: 'chakra_sync', chakraMessageId: 'c-1', attachmentType: 'image', mediaUrl: '/uploads/inbound/sync.jpg' },
    createdAt: new Date(Date.now() - 30_000),
  });
  // What messageRouter hands it: the webhook's own body and metadata.
  const webhook = (wamid: string) => ({
    conversationId: convId,
    waMessageId: wamid,
    body: 'ada yang warna hitam?',
    metadata: { baileys: { from: '628', type: 'image' }, attachmentType: 'image', quotedWaMessageId: 'wamid.Q' },
  });

  it('takes over a row the sync wrote, turning it into the webhook\'s row', async () => {
    const wamid = `${PREFIX}w1`;
    await syncRow(wamid);

    const claimed = await claimSyncedInbound(webhook(wamid));

    expect(claimed?.body).toBe('ada yang warna hitam?');
    expect(claimed?.metadata).toMatchObject({
      syncedFirst: true,
      quotedWaMessageId: 'wamid.Q',
      // The sync's own facts stay - its photo download is the only one when the webhook's failed.
      chakraMessageId: 'c-1',
      mediaUrl: '/uploads/inbound/sync.jpg',
    });
    expect(claimed?.metadata).not.toHaveProperty('source');
  });

  it('gives a row to one delivery only', async () => {
    const wamid = `${PREFIX}w2`;
    await syncRow(wamid);

    expect(await claimSyncedInbound(webhook(wamid))).not.toBeNull();
    expect(await claimSyncedInbound(webhook(wamid))).toBeNull();
  });

  it('gives a row to one delivery only when two race for it', async () => {
    const wamid = `${PREFIX}w3`;
    await syncRow(wamid);

    const results = await Promise.all([1, 2, 3, 4].map(() => claimSyncedInbound(webhook(wamid))));

    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it('never takes a row the webhook stored itself - a second delivery stays a duplicate', async () => {
    const wamid = `${PREFIX}w4`;
    await insertMessageIfNew({ conversationId: convId, role: 'user', body: 'halo', waMessageId: wamid, metadata: { baileys: {} } });

    expect(await claimSyncedInbound(webhook(wamid))).toBeNull();
    expect((await findMessageByWaMessageId(wamid))?.body).toBe('halo');
  });

  it('never takes an outbound row the sync imported', async () => {
    const wamid = `${PREFIX}w5`;
    await insertMessageIfNew({ conversationId: convId, role: 'assistant', body: 'Klu yg persis belum ada', waMessageId: wamid, metadata: { source: 'chakra_sync' } });

    expect(await claimSyncedInbound(webhook(wamid))).toBeNull();
  });
});
