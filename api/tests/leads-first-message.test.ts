/** listLeads firstMessage: the customer's first message since the lead began. Needs DATABASE_URL. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { contacts, conversations, leads, messages, phoneNumbers } from '../src/db/schema.js';

const { listLeads } = await import('../src/repositories/leads.js');

const P = '__firstmsg_test__';
const at = (s: string) => new Date(`${s}+07:00`);

async function cleanup() {
  const db = getDb();
  const mine = sql`(SELECT id FROM contacts WHERE wa_id LIKE ${`${P}%`})`;
  await db.execute(sql`DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE contact_id IN ${mine})`);
  await db.execute(sql`DELETE FROM conversations WHERE contact_id IN ${mine}`);
  await db.execute(sql`DELETE FROM leads WHERE contact_id IN ${mine}`);
  await db.execute(sql`DELETE FROM contacts WHERE wa_id LIKE ${`${P}%`}`);
  await db.execute(sql`DELETE FROM phone_numbers WHERE number LIKE ${`${P}%`}`);
}

describe('listLeads firstMessage', () => {
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    await cleanup();
    const db = getDb();
    const [ph] = await db.insert(phoneNumbers).values({ number: `${P}1`, wabaId: 'w', phoneNumberId: 'p' }).returning();
    const mk = async (key: string, lead: Partial<typeof leads.$inferInsert>, msgs: { role: string; body: string; t: string }[]) => {
      const [c] = await db.insert(contacts).values({ waId: `${P}${key}`, displayName: `Contoh ${key}` }).returning();
      const [l] = await db.insert(leads).values({ contactId: c!.id, utmCampaign: P, ...lead }).returning();
      ids[key] = l!.id;
      if (msgs.length === 0) return;
      const [cv] = await db.insert(conversations).values({ contactId: c!.id, phoneNumberId: ph!.id }).returning();
      for (const m of msgs) await db.insert(messages).values({ conversationId: cv!.id, role: m.role, body: m.body, createdAt: at(m.t) });
    };
    await mk('KUR', { kind: 'kurir', submittedAt: at('2020-05-02T10:00:00') }, [
      { role: 'assistant', body: 'Halo kak', t: '2020-05-02T10:00:00' },
      { role: 'user', body: `  Paket untuk gudang ${'x'.repeat(400)}  `, t: '2020-05-02T10:01:00' },
      { role: 'user', body: 'kedua', t: '2020-05-02T10:02:00' },
    ]);
    await mk('NOMSG', { kind: 'lainnya', submittedAt: at('2020-05-03T10:00:00') }, []);
    // Messages only from before the lead began: falls back to the contact's first user message.
    await mk('OLD', { kind: 'lainnya', submittedAt: at('2020-05-04T10:00:00'), firstContactAt: at('2020-05-04T10:00:00') }, [
      { role: 'user', body: 'pesan lama', t: '2020-05-01T10:00:00' },
    ]);
  });
  afterAll(cleanup);

  it('returns the first customer message, trimmed to 300 chars', async () => {
    const r = await listLeads({ page: 1, limit: 50, kind: 'non_lead', search: P });
    const row = r.items.find((i) => i.id === ids['KUR'])!;
    expect(row.firstMessage!.startsWith('Paket untuk gudang')).toBe(true);
    expect(row.firstMessage!.length).toBe(300);
  });

  it('is null with no messages, and falls back to an earlier message', async () => {
    const r = await listLeads({ page: 1, limit: 50, kind: 'non_lead', search: P });
    expect(r.items.find((i) => i.id === ids['NOMSG'])!.firstMessage).toBeNull();
    expect(r.items.find((i) => i.id === ids['OLD'])!.firstMessage).toBe('pesan lama');
  });
});
