/**
 * lead-kind-rule.test.ts - the lead pass is the only status decider; the non-sales detector
 * tags a lead's kind; /new and campaign-created leads record history. Needs DATABASE_URL.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import 'dotenv/config';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { contacts, leads, staffProfiles } from '../src/db/schema.js';
import {
  tagNonSalesLead,
  applyLeadStage,
  resetLeadsForContact,
  claimLeadByRequestId,
  upsertLeadFromImport,
  patchLead,
  applyAiLeadUpdate,
  findCurrentLeadForContact,
} from '../src/repositories/leads.js';
import { listLeadEvents } from '../src/repositories/leadEvents.js';
import { RESPOND_FIELD_DESC } from '../src/services/aiLayer.js';
import { detectNonSalesTopic } from '../src/services/escalationHandler.js';

const P = '__leadkind_test__';
const RID_CLAIM = '00000000-0000-4000-8000-0000000c1a11';
const RID_IMPORT = '00000000-0000-4000-8000-0000000c1a12';

describe('RESPOND_FIELD_DESC', () => {
  it('no longer lets the reply model set a lead status', () => {
    expect(RESPOND_FIELD_DESC.profile_update).not.toContain('lead_status');
    expect(RESPOND_FIELD_DESC.profile_update).toContain('these three');
  });
});

describe('lead kind rule, /new history, campaign-created leads', () => {
  let contactId: string;
  let staffId: string;

  const getLead = async (id: string) => (await getDb().select().from(leads).where(eq(leads.id, id)))[0]!;
  const leadsOf = async () => getDb().select().from(leads).where(eq(leads.contactId, contactId));
  const wipe = async () => {
    const db = getDb();
    const mine = sql`(SELECT id FROM leads WHERE contact_id = ${contactId} OR request_id IN (${RID_CLAIM}, ${RID_IMPORT}))`;
    await db.execute(sql`DELETE FROM lead_events WHERE lead_id IN ${mine}`);
    await db.execute(sql`DELETE FROM leads WHERE contact_id = ${contactId} OR request_id IN (${RID_CLAIM}, ${RID_IMPORT})`);
  };

  beforeAll(async () => {
    const db = getDb();
    await db.execute(sql`DELETE FROM staff_profiles WHERE email LIKE ${`${P}%`}`);
    await db.execute(sql`DELETE FROM contacts WHERE wa_id LIKE ${`${P}%`}`);
    const [c] = await db.insert(contacts).values({ waId: `${P}a` }).returning();
    contactId = c!.id;
    const [s] = await db.insert(staffProfiles).values({ email: `${P}@example.test`, passwordHash: 'x', name: 'T' }).returning();
    staffId = s!.id;
  });
  beforeEach(wipe);
  afterAll(async () => {
    await wipe();
    const db = getDb();
    await db.execute(sql`DELETE FROM staff_profiles WHERE email LIKE ${`${P}%`}`);
    await db.execute(sql`DELETE FROM contacts WHERE wa_id LIKE ${`${P}%`}`);
  });

  it('tagNonSalesLead sets kind from the topic, by rule, with an event', async () => {
    const [l] = await getDb().insert(leads).values({ contactId }).returning();
    await tagNonSalesLead(contactId, 'Lowongan kerja');
    const row = await getLead(l!.id);
    expect(row.kind).toBe('lamaran_kerja');
    expect(row.kindSetBy).toBe('rule');
    expect((await listLeadEvents(l!.id)).at(-1)).toMatchObject({ toKind: 'lamaran_kerja', actor: 'system', evidence: 'Lowongan kerja' });
  });

  it('tagNonSalesLead does nothing once staff set the kind, or with no lead', async () => {
    await tagNonSalesLead(contactId, 'Lowongan kerja'); // no lead: no throw
    const [l] = await getDb().insert(leads).values({ contactId }).returning();
    await patchLead(l!.id, { kind: 'lead', staffId });
    await tagNonSalesLead(contactId, 'Lowongan kerja');
    const row = await getLead(l!.id);
    expect(row.kind).toBe('lead');
    expect(row.kindSetBy).toBe('staff');
  });

  it.each(['quoted', 'won'] as const)('tagNonSalesLead leaves a %s buyer chasing their order a lead, with no event', async (status) => {
    const [l] = await getDb().insert(leads).values({ contactId, status }).returning();
    const topic = detectNonSalesTopic('kak saya sudah transfer ya');
    expect(topic).toBe('Pembayaran / status pesanan'); // the hand-off itself still happens
    await tagNonSalesLead(contactId, topic!);
    const row = await getLead(l!.id);
    expect(row).toMatchObject({ kind: 'lead', kindSetBy: null, status });
    expect(await listLeadEvents(l!.id)).toHaveLength(0);
  });

  it('tagNonSalesLead still tags a new lead from a courier message', async () => {
    const [l] = await getDb().insert(leads).values({ contactId }).returning();
    await tagNonSalesLead(contactId, 'Kurir / pengambilan pesanan');
    expect(await getLead(l!.id)).toMatchObject({ kind: 'kurir', kindSetBy: 'rule' });
  });

  it('applyAiLeadUpdate has no status branch: a status in the patch is ignored', async () => {
    const [l] = await getDb().insert(leads).values({ contactId }).returning();
    await applyAiLeadUpdate(contactId, { temperature: 'hot', status: 'won' } as never);
    const row = await getLead(l!.id);
    expect(row.status).toBe('new');
    expect(row.leadTemperature).toBe('hot');
  });

  it('/new rewinds a closed lead and records an event, clearing the outcome', async () => {
    const [l] = await getDb().insert(leads).values({ contactId }).returning();
    await applyLeadStage(l!.id, { status: 'lost', actor: 'ai', lostReason: 'harga', evidence: 'mahal' });
    await resetLeadsForContact(contactId);
    const row = await getLead(l!.id);
    expect(row.status).toBe('new');
    expect(row.closedAt).toBeNull();
    expect(row.lostReason).toBeNull();
    expect(row.outcomeEvidence).toBeNull();
    expect(row.outcomeMessageId).toBeNull();
    expect((await listLeadEvents(l!.id)).at(-1)).toMatchObject({
      fromStatus: 'lost', toStatus: 'new', actor: 'system', evidence: '/new reset',
    });
  });

  it('/new after a renewal rewinds only the current lead', async () => {
    const [old] = await getDb().insert(leads).values({
      contactId, status: 'lost', lostReason: 'harga', closedAt: new Date('2026-08-01T00:00:00Z'),
      submittedAt: new Date('2026-07-01T00:00:00Z'),
    }).returning();
    const [renewed] = await getDb().insert(leads).values({ contactId, status: 'quoted', previousLeadId: old!.id }).returning();
    const [campaign] = await getDb().insert(leads).values({
      contactId, requestId: RID_IMPORT, status: 'lost', submittedAt: new Date('2026-06-01T00:00:00Z'),
    }).returning();
    await resetLeadsForContact(contactId);
    expect(await getLead(renewed!.id)).toMatchObject({ status: 'new' });
    expect(await getLead(campaign!.id)).toMatchObject({ status: 'new' });
    expect(await getLead(old!.id)).toMatchObject({ status: 'lost', lostReason: 'harga' });
    expect(await listLeadEvents(old!.id)).toHaveLength(0);
    expect((await listLeadEvents(renewed!.id)).at(-1)).toMatchObject({ fromStatus: 'quoted', toStatus: 'new' });
  });

  it('/new rewinds an open organic lead even when a newer campaign lead is current', async () => {
    const [organic] = await getDb().insert(leads).values({
      contactId, status: 'quoted', leadTemperature: 'hot', submittedAt: new Date('2026-07-01T00:00:00Z'),
    }).returning();
    const [campaign] = await getDb().insert(leads).values({
      contactId, requestId: RID_IMPORT, status: 'contacted', submittedAt: new Date('2026-09-01T00:00:00Z'),
    }).returning();
    expect((await findCurrentLeadForContact(contactId))?.id).toBe(campaign!.id);
    await resetLeadsForContact(contactId);
    expect(await getLead(organic!.id)).toMatchObject({ status: 'new', leadTemperature: null });
    expect(await getLead(campaign!.id)).toMatchObject({ status: 'new' });
    expect((await listLeadEvents(organic!.id)).at(-1)).toMatchObject({ fromStatus: 'quoted', toStatus: 'new', evidence: '/new reset' });
    expect((await listLeadEvents(campaign!.id)).at(-1)).toMatchObject({ fromStatus: 'contacted', toStatus: 'new' });
  });

  it('/new writes no event for a lead already at new', async () => {
    const [l] = await getDb().insert(leads).values({ contactId }).returning();
    await resetLeadsForContact(contactId);
    expect(await listLeadEvents(l!.id)).toHaveLength(0);
  });

  it('claimLeadByRequestId records first_contact_at and a "-> new" event only on insert', async () => {
    const at = new Date('2026-11-01T03:00:00Z');
    await claimLeadByRequestId(RID_CLAIM, contactId, {}, at);
    let [row] = await leadsOf();
    expect(row!.firstContactAt?.toISOString()).toBe(at.toISOString());
    expect(await listLeadEvents(row!.id)).toHaveLength(1);
    expect((await listLeadEvents(row!.id))[0]).toMatchObject({ fromStatus: null, toStatus: 'new', actor: 'system' });
    // Dated by the message that created the lead, not by when it was recorded.
    expect((await listLeadEvents(row!.id))[0]!.createdAt.toISOString()).toBe(at.toISOString());
    await claimLeadByRequestId(RID_CLAIM, contactId, {}, new Date());
    [row] = await leadsOf();
    expect(await listLeadEvents(row!.id)).toHaveLength(1);
    expect(row!.firstContactAt?.toISOString()).toBe(at.toISOString());
  });

  it('claim onto an imported lead keeps first_contact_at null (conflict path untouched)', async () => {
    const imported = await upsertLeadFromImport({ requestId: RID_IMPORT, utmCampaign: 'x' });
    expect(imported!.firstContactAt).toBeNull();
    await claimLeadByRequestId(RID_IMPORT, contactId, {}, new Date());
    const [row] = await leadsOf();
    expect(row!.matchedAt).not.toBeNull();
  });
});
