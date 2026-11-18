/**
 * lead-detail-routes.test.ts - GET /api/v1/leads/:id, the reopen-days setting and the staff
 * language endpoint, through Fastify inject. Needs DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import 'dotenv/config';
import Fastify from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { contacts, leads, leadEvents, staffProfiles, appSettings } from '../src/db/schema.js';
import bcrypt from 'bcryptjs';

vi.mock('../src/middleware/apiKey.js', () => ({ apiKeyAuth: async () => {} }));

const { leadRoutes } = await import('../src/routes/dashboard/leads.js');
const { settingsRoutes } = await import('../src/routes/dashboard/settings.js');
const { staffRoutes } = await import('../src/routes/dashboard/staff.js');
const { authRoutes } = await import('../src/routes/dashboard/auth.js');

const P = '__leaddetail_test__';

describe('lead detail / reopen setting / staff language routes', () => {
  const app = Fastify();
  let oldLeadId: string;
  let newLeadId: string;
  let staffId: string;
  let savedSetting: unknown;
  let hadSetting = false;

  async function cleanup() {
    const db = getDb();
    const mine = sql`(SELECT id FROM contacts WHERE wa_id LIKE ${`${P}%`})`;
    await db.execute(sql`DELETE FROM lead_events WHERE lead_id IN (SELECT id FROM leads WHERE contact_id IN ${mine})`);
    await db.execute(sql`UPDATE leads SET previous_lead_id = NULL WHERE contact_id IN ${mine}`);
    await db.execute(sql`DELETE FROM leads WHERE contact_id IN ${mine}`);
    await db.execute(sql`DELETE FROM contacts WHERE wa_id LIKE ${`${P}%`}`);
    await db.execute(sql`DELETE FROM staff_profiles WHERE email LIKE ${`${P}%`}`);
  }

  beforeAll(async () => {
    await app.register(leadRoutes);
    await app.register(settingsRoutes);
    await app.register(staffRoutes);
    await app.register(authRoutes);
    await cleanup();
    const db = getDb();
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, 'lead_reopen_after_days'));
    hadSetting = !!row;
    savedSetting = row?.value;

    const [c] = await db.insert(contacts).values({ waId: `${P}a`, displayName: 'Detail Tester' }).returning();
    const [oldL] = await db.insert(leads).values({ contactId: c!.id, status: 'lost', lostReason: 'harga' }).returning();
    oldLeadId = oldL!.id;
    const [newL] = await db.insert(leads).values({ contactId: c!.id, previousLeadId: oldLeadId }).returning();
    newLeadId = newL!.id;
    await db.insert(leadEvents).values([
      { leadId: newLeadId, actor: 'system', toStatus: 'new', createdAt: new Date('2026-11-01T01:00:00Z') },
      { leadId: newLeadId, actor: 'ai', fromStatus: 'new', toStatus: 'contacted', createdAt: new Date('2026-11-01T02:00:00Z') },
    ]);
    const [s] = await db.insert(staffProfiles).values({
      email: `${P}@example.test`, passwordHash: await bcrypt.hash('pw12345678', 4), name: 'T',
    }).returning();
    staffId = s!.id;
  });

  afterAll(async () => {
    const db = getDb();
    if (hadSetting) {
      await db.update(appSettings).set({ value: savedSetting }).where(eq(appSettings.key, 'lead_reopen_after_days'));
    } else {
      await db.delete(appSettings).where(eq(appSettings.key, 'lead_reopen_after_days'));
    }
    await cleanup();
    await app.close();
  });

  it('returns the lead with contact, its events oldest first, and the previous lead', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/leads/${newLeadId}` });
    expect(res.statusCode).toBe(200);
    const { data, error } = res.json();
    expect(error).toBeNull();
    expect(data.lead.id).toBe(newLeadId);
    expect(data.lead.displayName).toBe('Detail Tester');
    expect(data.events.map((e: { toStatus: string }) => e.toStatus)).toEqual(['new', 'contacted']);
    expect(data.previousLead.id).toBe(oldLeadId);
  });

  it('previousLead is null when there is none', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/leads/${oldLeadId}` });
    expect(res.json().data.previousLead).toBeNull();
    expect(res.json().data.events).toEqual([]);
  });

  it('answers 404 for an unknown or non-UUID id', async () => {
    for (const id of ['00000000-0000-4000-8000-000000000000', 'abc', 'reports']) {
      const res = await app.inject({ method: 'GET', url: `/api/v1/leads/${id}` });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('NOT_FOUND');
    }
  });

  it('answers 409 LEAD_ALREADY_OPEN when reopening the old lost lead beside an open one', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/api/v1/leads/${oldLeadId}`, payload: { status: 'contacted' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('LEAD_ALREADY_OPEN');
    const [row] = await getDb().select().from(leads).where(eq(leads.id, oldLeadId));
    expect(row!.status).toBe('lost');
  });

  it('rejects reopen days outside 1-365 and stores a valid value', async () => {
    for (const days of [0, 400, 1.5, 'x']) {
      const res = await app.inject({ method: 'PATCH', url: '/api/v1/settings/lead-reopen-days', payload: { days } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('VALIDATION_ERROR');
    }
    const ok = await app.inject({ method: 'PATCH', url: '/api/v1/settings/lead-reopen-days', payload: { days: 45 } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data).toEqual({ days: 45 });
    const got = await app.inject({ method: 'GET', url: '/api/v1/settings/lead-reopen-days' });
    expect(got.json().data).toEqual({ days: 45 });
  });

  it('rejects an unknown language, stores en and returns it from verify-credentials', async () => {
    const bad = await app.inject({ method: 'PATCH', url: `/api/v1/staff/${staffId}/language`, payload: { language: 'fr' } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: 'PATCH', url: `/api/v1/staff/${staffId}/language`, payload: { language: 'en' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.language).toBe('en');
    const v = await app.inject({
      method: 'POST', url: '/api/v1/auth/verify-credentials',
      payload: { email: `${P}@example.test`, password: 'pw12345678' },
    });
    expect(v.statusCode).toBe(200);
    expect(v.json().data.language).toBe('en');
    const missing = await app.inject({ method: 'PATCH', url: '/api/v1/staff/00000000-0000-4000-8000-000000000000/language', payload: { language: 'id' } });
    expect(missing.statusCode).toBe(404);
  });
});
