/**
 * numbers-delete-route.test.ts - DELETE /api/v1/numbers/:id through Fastify inject.
 * A number with chats is refused with 409 and the chat count (live 2026-11-20: the database refused the
 * delete and the dashboard got a bare HTTP 500). Needs DATABASE_URL; creates and removes its own rows.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import 'dotenv/config';
import Fastify from 'fastify';
import { eq } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { contacts, conversations, phoneNumbers } from '../src/db/schema.js';

vi.mock('../src/middleware/apiKey.js', () => ({ apiKeyAuth: async () => {} }));

const { numberRoutes } = await import('../src/routes/dashboard/numbers.js');

const TAG = '__numdel__';

describe('DELETE /api/v1/numbers/:id', () => {
  const app = Fastify();
  const made = { numbers: [] as string[], contacts: [] as string[] };

  async function number(suffix: string): Promise<string> {
    const [row] = await getDb().insert(phoneNumbers).values({
      number: `+62000099${suffix}`, label: `${TAG}${suffix}`, wabaId: `${TAG}waba`, phoneNumberId: `${TAG}${suffix}`,
    }).returning();
    made.numbers.push(row!.id);
    return row!.id;
  }

  beforeAll(async () => { await app.register(numberRoutes); });

  afterAll(async () => {
    const db = getDb();
    for (const id of made.numbers) await db.delete(conversations).where(eq(conversations.phoneNumberId, id));
    for (const id of made.numbers) await db.delete(phoneNumbers).where(eq(phoneNumbers.id, id));
    for (const id of made.contacts) await db.delete(contacts).where(eq(contacts.id, id));
    await app.close();
  });

  it('deletes a number with no chats (204)', async () => {
    const id = await number('01');
    const res = await app.inject({ method: 'DELETE', url: `/api/v1/numbers/${id}` });
    expect(res.statusCode).toBe(204);
    expect(await getDb().select().from(phoneNumbers).where(eq(phoneNumbers.id, id))).toHaveLength(0);
  });

  it('refuses a number that still has chats: 409 with the count, nothing deleted', async () => {
    const id = await number('02');
    const db = getDb();
    for (const n of ['1', '2']) {
      const [c] = await db.insert(contacts).values({ waId: `62000099020${n}`, displayName: `${TAG}contact` }).returning();
      made.contacts.push(c!.id);
      await db.insert(conversations).values({ contactId: c!.id, phoneNumberId: id });
    }
    const res = await app.inject({ method: 'DELETE', url: `/api/v1/numbers/${id}` });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ data: null, error: 'NUMBER_HAS_CONVERSATIONS', details: { conversations: 2 } });
    expect(await db.select().from(phoneNumbers).where(eq(phoneNumbers.id, id))).toHaveLength(1);
  });

  it('404 for an unknown number', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/numbers/00000000-0000-4000-8000-000000000000' });
    expect(res.statusCode).toBe(404);
  });
});
