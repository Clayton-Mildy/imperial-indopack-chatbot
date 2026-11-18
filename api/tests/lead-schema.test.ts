/**
 * lead-schema.test.ts - migration 0023: lead kind/outcome columns, the open-organic unique index,
 * lead_events and staff_profiles.language. Needs DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { contacts, leads, staffProfiles } from '../src/db/schema.js';

const TEST_PREFIX = '__leadschema_test__';

async function cleanup() {
  const db = getDb();
  await db.execute(sql`DELETE FROM leads WHERE contact_id IN (SELECT id FROM contacts WHERE wa_id LIKE ${`${TEST_PREFIX}%`})`);
  await db.execute(sql`DELETE FROM contacts WHERE wa_id LIKE ${`${TEST_PREFIX}%`}`);
  await db.execute(sql`DELETE FROM staff_profiles WHERE email LIKE ${`${TEST_PREFIX}%`}`);
}

describe('lead schema (0023)', () => {
  let contactId: string;

  const insertOrganic = async (cid: string, status: string) => {
    const [row] = await getDb().insert(leads).values({ contactId: cid, status }).returning();
    return row!;
  };
  const staffRow = async () => {
    const [row] = await getDb()
      .insert(staffProfiles)
      .values({ email: `${TEST_PREFIX}@example.test`, passwordHash: 'x', name: 'Test' })
      .returning();
    return row!;
  };
  const clearLeads = () => getDb().execute(sql`DELETE FROM leads WHERE contact_id = ${contactId}`);

  beforeAll(async () => {
    await cleanup();
    const [c] = await getDb().insert(contacts).values({ waId: `${TEST_PREFIX}a` }).returning();
    contactId = c!.id;
  });
  afterAll(cleanup);

  it('allows a Lost organic lead and an open one for the same contact', async () => {
    await insertOrganic(contactId, 'lost');
    await expect(insertOrganic(contactId, 'new')).resolves.toBeDefined();
    await clearLeads();
  });

  it('rejects two open organic leads for one contact', async () => {
    await insertOrganic(contactId, 'new');
    await expect(insertOrganic(contactId, 'contacted')).rejects.toThrow(/uq_leads_organic_open_contact/);
    await clearLeads();
  });

  it('defaults kind to lead and language to id', async () => {
    const lead = await insertOrganic(contactId, 'new');
    expect(lead.kind).toBe('lead');
    expect(lead.firstContactAt).toBeNull();
    expect((await staffRow()).language).toBe('id');
    await clearLeads();
  });

  it('indexes leads by contact (0024)', async () => {
    const { rows } = await getDb().execute(sql`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'leads' AND indexname = 'idx_leads_contact'`);
    expect(String(rows[0]?.['indexdef'])).toMatch(/\(contact_id\)/);
  });

  it('records lead_events and cascades on lead delete', async () => {
    const lead = await insertOrganic(contactId, 'new');
    const db = getDb();
    await db.execute(sql`INSERT INTO lead_events (lead_id, from_status, to_status, actor) VALUES (${lead.id}, 'new', 'contacted', 'ai')`);
    await db.execute(sql`DELETE FROM leads WHERE id = ${lead.id}`);
    const left = await db.execute(sql`SELECT 1 FROM lead_events WHERE lead_id = ${lead.id}`);
    expect(left.rows.length).toBe(0);
  });
});
