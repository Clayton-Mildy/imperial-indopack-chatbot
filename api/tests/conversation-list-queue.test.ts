/**
 * conversation-list-queue.test.ts
 *
 * The dashboard's Percakapan inbox (views Perlu tim / Dibalas AI / Selesai, search, each row's name,
 * business, brand tags, last message and PO-form time) and the Perlu Tim queue (hand-offs grouped by
 * category, oldest first, with the order details still missing). Both are SQL over real Postgres.
 *
 * The local DB is shared with other test files and may hold real chats, so every assertion about
 * which rows came back is narrowed to this file's own conversations (PREFIX fixture idiom, as in
 * handoff-category.test.ts). The prefix's underscores are LIKE wildcards, so searching for it also
 * exercises the escaping.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import 'dotenv/config';

vi.mock('../src/middleware/apiKey.js', () => ({ apiKeyAuth: async () => {} }));

import Fastify from 'fastify';
import { sql } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { contacts, contactProfiles, conversations, messages, phoneNumbers } from '../src/db/schema.js';
import { listConversations } from '../src/repositories/conversations.js';
import { getBotSettings } from '../src/repositories/appSettings.js';
import { getTeamQueue, type TeamQueue } from '../src/services/teamQueue.js';
import { conversationRoutes } from '../src/routes/dashboard/conversations.js';
import { teamQueueRoutes } from '../src/routes/dashboard/teamQueue.js';
import { HANDOFF_CATEGORIES, type HandoffCategory } from '../src/domain/handoff.js';
import { CANNED_PO_FORM_FROM_TEAM, poFormMessage } from '../src/domain/constants.js';
import { MESSAGE_SOURCE } from '../src/domain/messageSources.js';

const PREFIX = '__conv_list_queue__';
const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000);

interface Msg { role: string; body: string; minAgo: number; source?: string; senderName?: string }
interface Seed {
  nn: string;
  status: string;
  category?: HandoffCategory | null;
  assigned?: string | null;
  displayName: string;
  profile?: Record<string, unknown>;
  updatedMinAgo?: number;
  msgs: Msg[];
}

const ANDI_PROFILE = {
  name: 'Andi Contoh',
  business_name: 'Katering Contoh Sehat',
  brands: ['imperial_indopack', 'merek_lain'],
  items: [{ product: 'Box Ivory', print: 'full color', size: '22x22x7', qty: 5000, qty_unit: 'pcs', has_design: true }],
};

const SEEDS: Record<'andi' | 'rina' | 'tanpa' | 'lina' | 'aktif' | 'selesai', Seed> = {
  // Escalated, every detail known; the PO link went out, then the team's placeholder promise.
  andi: {
    nn: '41', status: 'escalated', category: 'harga_custom', displayName: 'Contoh WA Andi', profile: ANDI_PROFILE,
    msgs: [
      { role: 'user', body: 'Halo kak, saya cari box nasi', minAgo: 90 },
      { role: 'assistant', body: poFormMessage('https://forms.gle/contoh-form-po'), minAgo: 80, source: MESSAGE_SOURCE.poForm },
      { role: 'assistant', body: CANNED_PO_FORM_FROM_TEAM, minAgo: 70, source: MESSAGE_SOURCE.poForm },
      { role: 'assistant', body: 'Baik kak, tim kami cek dulu ya', minAgo: 60, source: 'escalation' },
      { role: 'user', body: 'Kalau ukuran 22x22x7 bisa kak?', minAgo: 50 },
    ],
  },
  // Taken over by staff; design unknown; only the placeholder promise, never the link.
  rina: {
    nn: '42', status: 'needs_human', category: 'harga_custom', assigned: 'Admin QA', displayName: 'Contoh WA Rina',
    profile: {
      name: 'Rina Contoh', business_name: 'Bakso Contoh', brands: ['kertas_supreme'],
      items: [{ product: 'Kertas Supreme 64 gsm', print: '2 warna', size: '32x32', qty: 10, qty_unit: 'rim' }],
    },
    msgs: [
      { role: 'user', body: 'Mau kertas supreme 10 rim', minAgo: 40 },
      { role: 'assistant', body: 'Baik kak, tim kami cek dulu ya', minAgo: 30, source: 'escalation' },
      { role: 'assistant', body: CANNED_PO_FORM_FROM_TEAM, minAgo: 25, source: MESSAGE_SOURCE.poForm },
      { role: 'assistant', body: 'Halo kak, saya Admin QA', minAgo: 20, senderName: 'Admin QA' },
    ],
  },
  // Held with no category and no escalation message: grouped as lainnya, waiting since updated_at.
  tanpa: {
    nn: '43', status: 'needs_human', category: null, assigned: 'Admin Contoh Lain', displayName: 'Contoh Tanpa Kategori',
    updatedMinAgo: 10, msgs: [{ role: 'user', body: 'Halo', minAgo: 12 }],
  },
  // A design said before any product: the order-level has_design.
  lina: {
    nn: '44', status: 'escalated', category: 'desain_masuk', displayName: 'Contoh WA Lina', profile: { name: 'Lina Contoh', has_design: true },
    msgs: [
      { role: 'user', body: '[Foto] Ini logo saya kak', minAgo: 15 },
      { role: 'assistant', body: 'Terima kasih logonya kak', minAgo: 11, source: 'escalation' },
    ],
  },
  aktif: { nn: '45', status: 'active', displayName: 'Contoh Aktif', msgs: [{ role: 'user', body: 'Berapa harga kertas supreme?', minAgo: 5 }] },
  selesai: { nn: '46', status: 'resolved', displayName: 'Contoh WA Selesai', profile: { name: 'Contoh Selesai' }, msgs: [{ role: 'user', body: 'Terima kasih', minAgo: 100 }] },
};

const id: Record<keyof typeof SEEDS, string> = { andi: '', rina: '', tanpa: '', lina: '', aktif: '', selesai: '' };
const ours = () => new Set(Object.values(id));
const waOf = (nn: string) => `${PREFIX}62812000070${nn}`;

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
  const [number] = await db.insert(phoneNumbers).values({ number: `${PREFIX}n`, wabaId: 'test', phoneNumberId: 'test' }).returning();
  for (const [key, s] of Object.entries(SEEDS) as [keyof typeof SEEDS, Seed][]) {
    const [contact] = await db.insert(contacts).values({ waId: waOf(s.nn), displayName: s.displayName }).returning();
    if (s.profile) await db.insert(contactProfiles).values({ contactId: contact!.id, profile: s.profile });
    const [conv] = await db.insert(conversations).values({
      contactId: contact!.id, phoneNumberId: number!.id, status: s.status,
      handoffCategory: s.category ?? null, assignedAgent: s.assigned ?? null,
      createdAt: ago(120), updatedAt: ago(s.updatedMinAgo ?? 1),
    }).returning();
    id[key] = conv!.id;
    for (const m of s.msgs) {
      await db.insert(messages).values({
        conversationId: conv!.id, role: m.role, body: m.body, senderName: m.senderName ?? null,
        metadata: m.source ? { source: m.source } : null, createdAt: ago(m.minAgo),
      });
    }
  }
});

afterAll(cleanup);

const list = (p: { view?: 'team' | 'ai' | 'resolved'; search?: string }) => listConversations({ page: 1, limit: 100, ...p });
const ourIds = (items: { id: string }[]) => items.map((i) => i.id).filter((i) => ours().has(i)).sort();

describe('the conversation list', () => {
  it('view=team lists escalated and needs_human only, with counts', async () => {
    const team = await list({ view: 'team', search: PREFIX });
    expect(ourIds(team.items)).toEqual([id.andi, id.rina, id.tanpa, id.lina].sort());
    expect(team.items.every((i) => i.status === 'escalated' || i.status === 'needs_human')).toBe(true);
    expect(team.total).toBe(4);
    // The tabs' counts follow the search, never the view.
    expect(team.counts).toEqual({ all: 6, team: 4, ai: 1, resolved: 1 });

    expect(ourIds((await list({ view: 'ai', search: PREFIX })).items)).toEqual([id.aktif]);
    expect(ourIds((await list({ view: 'resolved', search: PREFIX })).items)).toEqual([id.selesai]);
    const all = await list({ search: PREFIX });
    expect(ourIds(all.items)).toEqual([...ours()].sort());
    expect(all.total).toBe(6);
  });

  it('search finds a business name and treats % literally', async () => {
    expect(ourIds((await list({ search: 'Contoh Sehat' })).items)).toEqual([id.andi]);
    expect(ourIds((await list({ search: 'katering contoh' })).items)).toEqual([id.andi]);
    expect(ourIds((await list({ search: 'Rina Contoh' })).items)).toEqual([id.rina]);          // profile name
    expect(ourIds((await list({ search: 'Contoh Tanpa' })).items)).toEqual([id.tanpa]);        // display name
    expect(ourIds((await list({ search: '6281200007043' })).items)).toEqual([id.tanpa]);       // wa_id
    // Escaped: an unescaped % or _ would match every row / the space in "Contoh Sehat".
    expect(ourIds((await list({ search: '%' })).items)).toEqual([]);
    expect(ourIds((await list({ search: 'Contoh_Sehat' })).items)).toEqual([]);
    expect(ourIds((await list({ search: '\\' })).items)).toEqual([]);
  });

  it('a row carries name, business, brands, last message and PO time', async () => {
    const { items } = await list({ search: PREFIX });
    const andi = items.find((i) => i.id === id.andi)!;
    expect(andi).toMatchObject({
      customerName: 'Andi Contoh',
      businessName: 'Katering Contoh Sehat',
      brands: ['imperial_indopack'],
      lastMessage: { body: 'Kalau ukuran 22x22x7 bisa kak?', role: 'user', senderName: null },
      handoffCategory: 'harga_custom',
      status: 'escalated',
      contact: { waId: waOf('41'), displayName: 'Contoh WA Andi' },
      phoneNumber: { number: `${PREFIX}n` },
      unread: false,
    });
    // The link went out 80 minutes ago; the placeholder promise 70 minutes ago is not a PO form.
    expect(andi.poFormSentAt?.toISOString()).toBe(ago(80).toISOString());
    expect(andi.escalatedAt?.toISOString()).toBe(ago(60).toISOString());
    expect(andi.lastMessageAt.toISOString()).toBe(ago(50).toISOString());

    const rina = items.find((i) => i.id === id.rina)!;
    expect(rina).toMatchObject({
      customerName: 'Rina Contoh', businessName: 'Bakso Contoh', brands: ['kertas_supreme'],
      lastMessage: { body: 'Halo kak, saya Admin QA', role: 'assistant', senderName: 'Admin QA' },
      assignedAgent: 'Admin QA', poFormSentAt: null,
    });

    // No profile: the WhatsApp name, no business, no brands, no PO form.
    expect(items.find((i) => i.id === id.aktif)).toMatchObject({
      customerName: 'Contoh Aktif', businessName: null, brands: [], poFormSentAt: null, handoffCategory: null, escalatedAt: null,
    });
  });

  it('GET /api/v1/conversations takes view and search, and meta carries the counts', async () => {
    const app = Fastify();
    await app.register(conversationRoutes);
    const res = await app.inject({ method: 'GET', url: `/api/v1/conversations?view=team&search=${encodeURIComponent(PREFIX)}&limit=100` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.map((r: { id: string }) => r.id).sort()).toEqual([id.andi, id.rina, id.tanpa, id.lina].sort());
    expect(body.meta).toEqual({ page: 1, limit: 100, total: 4, counts: { all: 6, team: 4, ai: 1, resolved: 1 } });

    const bad = await app.inject({ method: 'GET', url: '/api/v1/conversations?view=semua' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ data: null, error: 'VALIDATION_ERROR' });
    await app.close();
  });
});

describe('the Perlu Tim queue', () => {
  const ourItems = (q: TeamQueue, category: HandoffCategory) =>
    q.groups.find((g) => g.category === category)!.items.filter((i) => ours().has(i.conversationId));

  it('the queue groups by category oldest first and filters by assignee', async () => {
    const q = await getTeamQueue();
    expect(q.groups.map((g) => g.category)).toEqual([...HANDOFF_CATEGORIES]);
    expect(q.groups[0]!.category).toBe('harga_custom');
    expect(ourItems(q, 'harga_custom').map((i) => i.conversationId)).toEqual([id.andi, id.rina]);
    expect(ourItems(q, 'desain_masuk').map((i) => i.conversationId)).toEqual([id.lina]);
    expect(ourItems(q, 'lainnya').map((i) => i.conversationId)).toEqual([id.tanpa]);
    for (const cat of ['pesanan_besar', 'minta_orang', 'komplain', 'bukan_pembeli'] as const) expect(ourItems(q, cat)).toEqual([]);

    const mine = await getTeamQueue({ assignedTo: 'Admin QA' });
    const mineOurs = mine.groups.flatMap((g) => g.items).filter((i) => ours().has(i.conversationId));
    expect(mineOurs.map((i) => i.conversationId)).toEqual([id.rina]);
    expect(mine.groups.flatMap((g) => g.items).every((i) => i.assignedAgent === 'Admin QA')).toBe(true);
    expect(mine.groups.map((g) => g.category)).toEqual([...HANDOFF_CATEGORIES]);
  });

  it('each item says who, what, which details are missing and since when', async () => {
    const q = await getTeamQueue();
    const [andi, rina] = ourItems(q, 'harga_custom');
    expect(andi).toEqual({
      conversationId: id.andi, customerName: 'Andi Contoh', businessName: 'Katering Contoh Sehat', waId: waOf('41'),
      brands: ['imperial_indopack'], itemsSummary: 'Box Ivory, cetak full color · 22x22x7 · 5.000 pcs (10 rim) · desain ada',
      detailsFilled: 6, missing: [], waitingSince: ago(60).toISOString(), assignedAgent: null, status: 'escalated',
    });
    expect(rina).toMatchObject({
      detailsFilled: 5, missing: ['design'], status: 'needs_human', assignedAgent: 'Admin QA',
      itemsSummary: 'Kertas Supreme 64 gsm, cetak 2 warna · 32x32 · 10 rim (5.000 pcs)', waitingSince: ago(30).toISOString(),
    });
    // No escalation message: waiting since the row's updated_at. No profile: every detail missing.
    expect(ourItems(q, 'lainnya')[0]).toMatchObject({
      customerName: 'Contoh Tanpa Kategori', businessName: null, brands: [], itemsSummary: '',
      detailsFilled: 0, missing: ['name', 'business_name', 'model', 'size', 'qty', 'design'], waitingSince: ago(10).toISOString(),
    });
    // The order-level design fact counts.
    expect(ourItems(q, 'desain_masuk')[0]).toMatchObject({ detailsFilled: 2, missing: ['business_name', 'model', 'size', 'qty'] });
  });

  it('counts the waiting chats, the oldest wait and the reminder setting', async () => {
    const q = await getTeamQueue();
    const items = q.groups.flatMap((g) => g.items);
    expect(q.waitingCount).toBe(items.length);
    expect(q.oldestWaitingSince).toBe(items.map((i) => i.waitingSince).sort()[0]);
    expect(q.reminderMinutes).toBe((await getBotSettings()).teamReminderMinutes);
    for (const g of q.groups) expect(g.items.map((i) => i.waitingSince)).toEqual(g.items.map((i) => i.waitingSince).sort());
  });

  it('GET /api/v1/team-queue?assignedTo= returns the queue', async () => {
    const app = Fastify();
    await app.register(teamQueueRoutes);
    const res = await app.inject({ method: 'GET', url: '/api/v1/team-queue?assignedTo=Admin%20QA' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: TeamQueue; error: null };
    expect(body.error).toBeNull();
    expect(body.data.groups.map((g) => g.category)).toEqual([...HANDOFF_CATEGORIES]);
    expect(body.data.groups.flatMap((g) => g.items).filter((i) => ours().has(i.conversationId)).map((i) => i.conversationId)).toEqual([id.rina]);
    expect((await app.inject({ method: 'GET', url: '/api/v1/team-queue' })).statusCode).toBe(200);
    await app.close();
  });
});
