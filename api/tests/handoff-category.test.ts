/**
 * handoff-category.test.ts
 *
 * Every hand-off stores why the chat went to the team, so the dashboard's Perlu Tim queue can group
 * them (Harga custom, Desain masuk, Pesanan besar, Minta bicara dengan orang, Komplain, Bukan pembeli,
 * Lainnya). classifyHandoff is pure; the store/clear rules and the staff takeover are SQL, so they run
 * against real Postgres. Same PREFIX fixture idiom as claim-synced-inbound.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import 'dotenv/config';

// Hoisted with the vi.mock calls, above the static imports below.
const { mockNotifyStaff } = vi.hoisted(() => ({ mockNotifyStaff: vi.fn() }));
vi.mock('../src/services/whatsappSender.js', () => ({ sendTextMessage: vi.fn(async () => 'wamid-handoff') }));
vi.mock('../src/services/staffNotify.js', () => ({ notifyStaff: mockNotifyStaff }));
vi.mock('../src/middleware/apiKey.js', () => ({ apiKeyAuth: async () => {} }));

import Fastify from 'fastify';
import { sql } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { contacts, phoneNumbers } from '../src/db/schema.js';
import { HANDOFF_CATEGORIES, HANDOFF_LABEL, NO_SIGNALS, classifyHandoff } from '../src/domain/handoff.js';
import {
  upsertConversation,
  findConversationById,
  resetConversationToActive,
  resetConversationContext,
  updateConversationStatus,
} from '../src/repositories/conversations.js';
import { escalateConversation } from '../src/services/escalationHandler.js';
import { markHumanTakeover } from '../src/services/humanTakeover.js';
import { conversationRoutes } from '../src/routes/dashboard/conversations.js';

describe('classifyHandoff', () => {
  it.each([
    [{ nonSales: true, complaint: true }, 'bukan_pembeli'],
    [{ complaint: true, humanRequested: true }, 'komplain'],
    [{ humanRequested: true, priceOutcomes: ['not_in_catalog'] }, 'minta_orang'],
    [{ priceOutcomes: ['quote', 'above_top_tier'] }, 'pesanan_besar'],
    [{ priceOutcomes: ['not_in_catalog'], designReceived: true }, 'harga_custom'],
    [{ designReceived: true }, 'desain_masuk'],
  ])('%o → %s', (s, want) => expect(classifyHandoff({ ...NO_SIGNALS, ...s } as typeof NO_SIGNALS, 'Low confidence')).toBe(want));

  it('falls back to the reason text', () => expect(classifyHandoff(NO_SIGNALS, 'ukuran 22x22x7 tidak ada di katalog')).toBe('harga_custom'));
  it('defaults to lainnya', () => expect(classifyHandoff(NO_SIGNALS, 'AI call failed: timeout')).toBe('lainnya'));

  it('reads each fallback phrase', () => {
    expect(classifyHandoff(NO_SIGNALS, 'Box ivory cetak di luar katalog')).toBe('harga_custom');
    expect(classifyHandoff(NO_SIGNALS, 'Ukuran custom 25x25')).toBe('harga_custom');
    expect(classifyHandoff(NO_SIGNALS, '150 rim, di atas tingkat teratas')).toBe('pesanan_besar');
    expect(classifyHandoff(NO_SIGNALS, 'Pesanan besar 20.000 pcs')).toBe('pesanan_besar');
    expect(classifyHandoff(NO_SIGNALS, 'Pelanggan mengirim logo')).toBe('desain_masuk');
    expect(classifyHandoff(NO_SIGNALS, 'Lowongan kerja - bukan pertanyaan produk')).toBe('bukan_pembeli');
  });

  // A price quote or a minimum is not a hand-off reason by itself.
  it('ignores quote and below_minimum outcomes', () =>
    expect(classifyHandoff({ ...NO_SIGNALS, priceOutcomes: ['quote', 'below_minimum'] }, 'Low confidence')).toBe('lainnya'));

  it('labels every category', () => {
    expect(HANDOFF_CATEGORIES.map((c) => HANDOFF_LABEL[c])).toEqual([
      'Harga custom', 'Desain masuk', 'Pesanan besar', 'Minta bicara dengan orang', 'Komplain', 'Bukan pembeli', 'Lainnya',
    ]);
  });
});

const PREFIX = '__handoff_category_test__';
const WA = '6281200007031';

describe('handoff category in the database', () => {
  let conv: Awaited<ReturnType<typeof upsertConversation>>;
  let phone: Parameters<typeof escalateConversation>[4];

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
    const [contact] = await db.insert(contacts).values({ waId: `${PREFIX}${WA}`, displayName: 'Contoh Handoff' }).returning();
    const [number] = await db.insert(phoneNumbers).values({ number: `${PREFIX}n`, wabaId: 'test', phoneNumberId: 'test' }).returning();
    conv = await upsertConversation(contact!.id, number!.id);
    phone = number as unknown as Parameters<typeof escalateConversation>[4];
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await resetConversationToActive(conv.id);
  });

  afterAll(cleanup);

  it('stores the category on escalation and clears it on return to AI', async () => {
    await escalateConversation(conv, 'di atas tingkat teratas', WA, false, phone, undefined, 'pesanan_besar');
    expect((await findConversationById(conv.id))?.handoffCategory).toBe('pesanan_besar');
    await resetConversationToActive(conv.id);
    expect((await findConversationById(conv.id))?.handoffCategory).toBeNull();
  });

  it('a staff takeover keeps the reason and category and records the assignee', async () => {
    await escalateConversation(conv, 'ukuran 22x22x7 tidak ada di katalog', WA, false, phone, undefined, 'harga_custom');
    await markHumanTakeover(conv.id, 'Admin QA');
    expect(await findConversationById(conv.id)).toMatchObject({ status: 'needs_human', escalationReason: 'ukuran 22x22x7 tidak ada di katalog', handoffCategory: 'harga_custom', assignedAgent: 'Admin QA' });
  });

  it('falls back to the reason text when the caller names no category, and says it in the staff push', async () => {
    await escalateConversation(conv, 'Box 22x22x7 tidak ada di katalog', WA, false, phone);
    expect((await findConversationById(conv.id))?.handoffCategory).toBe('harga_custom');
    expect(mockNotifyStaff).toHaveBeenCalledWith(expect.objectContaining({ title: 'Perlu tim: Harga custom' }));
  });

  // Dashboard PATCH: take-over keeps it, return to AI and resolve clear it with the reason.
  it('keeps the category on a status change that names none, and clears it leaving the held state', async () => {
    await escalateConversation(conv, 'Pelanggan mengirim logo', WA, false, phone, undefined, 'desain_masuk');
    await updateConversationStatus(conv.id, 'needs_human');
    expect((await findConversationById(conv.id))?.handoffCategory).toBe('desain_masuk');
    await updateConversationStatus(conv.id, 'active');
    expect(await findConversationById(conv.id)).toMatchObject({ handoffCategory: null, escalationReason: null });

    await escalateConversation(conv, 'Komplain box penyok', WA, false, phone, undefined, 'komplain');
    await updateConversationStatus(conv.id, 'resolved');
    expect((await findConversationById(conv.id))?.handoffCategory).toBeNull();
  });

  // The takeover now records an assignee, and the router stays silent on any assigned chat: handing
  // the chat back to the AI must let the bot answer again.
  it('return to AI after a takeover clears the assignee', async () => {
    await escalateConversation(conv, 'Komplain box penyok', WA, false, phone, undefined, 'komplain');
    await markHumanTakeover(conv.id, 'Admin QA');
    await updateConversationStatus(conv.id, 'active');
    expect(await findConversationById(conv.id)).toMatchObject({ status: 'active', assignedAgent: null, handoffCategory: null });

    await markHumanTakeover(conv.id, 'Admin QA');
    await updateConversationStatus(conv.id, 'resolved');
    await resetConversationToActive(conv.id);
    expect(await findConversationById(conv.id)).toMatchObject({ status: 'active', assignedAgent: null });
  });

  it('/new clears the category and the assignee', async () => {
    await escalateConversation(conv, 'Pelanggan minta bicara dengan admin', WA, false, phone, undefined, 'minta_orang');
    await markHumanTakeover(conv.id, 'Admin QA');
    await resetConversationContext(conv.id);
    expect(await findConversationById(conv.id)).toMatchObject({ status: 'active', handoffCategory: null, assignedAgent: null, escalationReason: null });
  });

  it('maps the team notes fields, empty until a later task writes them', async () => {
    expect(await findConversationById(conv.id)).toMatchObject({ teamNotes: null, teamNotesUpdatedAt: null, teamNotesUpdatedBy: null });
  });

  // The dashboard PATCH: every held chat is in a Perlu Tim group, and return to AI clears the hold.
  it('a dashboard take-over keeps the category, or reads one off the reason; return to AI clears it', async () => {
    const app = Fastify();
    await app.register(conversationRoutes);
    const patch = (payload: Record<string, unknown>) => app.inject({ method: 'PATCH', url: `/api/v1/conversations/${conv.id}`, payload });

    expect((await patch({ status: 'needs_human', assignedAgent: 'Admin QA' })).json().data).toMatchObject({ status: 'needs_human', handoffCategory: 'lainnya', assignedAgent: 'Admin QA' });
    expect((await patch({ status: 'active' })).json().data).toMatchObject({ status: 'active', handoffCategory: null, assignedAgent: null });

    await escalateConversation(conv, 'Pelanggan mengirim logo', WA, false, phone, undefined, 'desain_masuk');
    expect((await patch({ status: 'needs_human' })).json().data).toMatchObject({ handoffCategory: 'desain_masuk', escalationReason: 'Pelanggan mengirim logo' });
    await app.close();
  });

  it('refuses a category outside the list', async () => {
    await expect(getDb().execute(sql`UPDATE conversations SET handoff_category = 'harga' WHERE id = ${conv.id}`)).rejects.toThrow();
  });
});
