import { eq, and, or, ilike, inArray, desc, asc, gte, lt, sql, type SQL, type AnyColumn } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { leads, contacts, contactProfiles, leadOrders, staffProfiles } from '../db/schema.js';
import { canAdvance, kindFromNonSalesTopic } from '../domain/leadStages.js';
import { itemKey, mergeOrderFacts, type BrandSlug, type OrderItem } from '../domain/orderProfile.js';
import { insertLeadEvent, messageTimeSql } from './leadEvents.js';
import type {
  LeadActor,
  ContactProfileFollowUpStatus,
  ConversationStatus,
  Lead,
  LeadCampaignSummary,
  LeadStatus,
  LeadKind,
  LeadKindSetBy,
  LostReason,
  LeadTemperature,
  LeadWithContact,
  PaginationParams,
} from '../domain/types.js';
import { ORGANIC_CAMPAIGN } from '../domain/types.js';
import { CANNED_PO_FORM_FROM_TEAM } from '../domain/constants.js';

// ─── date bounds ───────────────────────────────────────────────────────────

// Staff filter by calendar day in WIB (UTC+7). `new Date('2026-08-23')` is UTC midnight,
// i.e. 07:00 WIB, so a lead submitted at 2am WIB would land in the previous day's bucket -
// exactly the query staff run most ("what came in today"). Indonesia has one fixed offset
// year-round, so the whole fix is the literal suffix; no timezone library.
const WIB_OFFSET = '+07:00';

export function wibDayStart(day: string): Date | null {
  const d = new Date(`${day}T00:00:00${WIB_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Bounds for `submitted_at`: [start, end) with endDate's whole WIB day included. */
function dateConditions(params: { startDate?: string; endDate?: string }) {
  const conditions = [];
  if (params.startDate) {
    const start = wibDayStart(params.startDate);
    if (start) conditions.push(gte(leads.submittedAt, start));
  }
  if (params.endDate) {
    const end = wibDayStart(params.endDate);
    if (end) {
      end.setUTCDate(end.getUTCDate() + 1);
      conditions.push(lt(leads.submittedAt, end));
    }
  }
  return conditions;
}

// ─── campaign bucketing ────────────────────────────────────────────────────

// A lead that came through a marketing form but whose UTM row hasn't been imported yet. It
// did come from a campaign - we just don't know which - so it reads as "Campaign" rather
// than as a missing value, and sits opposite Organik.
const UNTAGGED_CAMPAIGN = 'Campaign';

// An explicit campaign always wins, so a lead tagged by hand in the dashboard leaves the
// organic bucket even though it has no request_id. Organic means "no form AND no campaign".
// listLeads' campaign filter mirrors this - keep the two in step.
const CAMPAIGN_BUCKET_SQL = sql`
  CASE WHEN coalesce(utm_campaign, '') <> '' THEN utm_campaign
       WHEN request_id IS NULL THEN ${ORGANIC_CAMPAIGN}
       ELSE ${UNTAGGED_CAMPAIGN} END
`;

/**
 * The same rule in TypeScript, for callers holding a row rather than writing SQL (the Excel
 * export). Kept in this file, immediately under the SQL it mirrors, so the two cannot drift
 * apart unnoticed - the dashboard has a third copy in LeadsClient.tsx for the same reason.
 */
export function campaignOf(lead: Pick<Lead, 'utmCampaign' | 'requestId'>): string {
  if (lead.utmCampaign?.trim()) return lead.utmCampaign.trim();
  return lead.requestId === null ? ORGANIC_CAMPAIGN : UNTAGGED_CAMPAIGN;
}

// ─── writers (three, any order, all idempotent) ────────────────────────────

// jsonb merge rather than replace, so the Excel and the WhatsApp template can each
// contribute fields without clobbering the other. Same idiom as contactProfiles.
function mergePayload(patch: Record<string, unknown>) {
  return sql`coalesce(${leads.payload}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`;
}

/**
 * Writer 1 - marketing's campaign data. The only source of UTM values, since the customer's
 * WhatsApp template never carries them.
 *
 * Two callers, same semantics: the Excel import (many rows) and the dashboard's campaign
 * modal (one row typed by hand). Both are keyed by request_id, so adding a campaign before
 * the customer chats and adding it after are the same operation.
 *
 * Deliberately never writes contact_id, matched_at, status or deal_value_idr: re-importing
 * the same export must not undo a WhatsApp match or reset a salesperson's edit.
 */
export async function upsertLeadFromImport(row: {
  requestId: string;
  utmId?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
  payload?: Record<string, unknown>;
  submittedAt?: Date | null;
}): Promise<Lead | null> {
  const db = getDb();
  const utm = {
    utmId: row.utmId ?? null,
    utmSource: row.utmSource ?? null,
    utmMedium: row.utmMedium ?? null,
    utmCampaign: row.utmCampaign ?? null,
    utmTerm: row.utmTerm ?? null,
    utmContent: row.utmContent ?? null,
  };
  const payload = row.payload ?? {};

  const [saved] = await db
    .insert(leads)
    .values({
      requestId: row.requestId,
      ...utm,
      payload,
      ...(row.submittedAt ? { submittedAt: row.submittedAt } : {}),
    })
    .onConflictDoUpdate({
      target: leads.requestId,
      targetWhere: sql`${leads.requestId} IS NOT NULL`,
      set: {
        ...utm,
        payload: mergePayload(payload),
        ...(row.submittedAt ? { submittedAt: row.submittedAt } : {}),
        updatedAt: new Date(),
      },
    })
    .returning();
  // first_contact_at stays null on insert: the customer has not chatted yet.
  return saved ? mapLead(saved) : null;
}

/**
 * Writer 2 - a WhatsApp message carrying "Request ID: <uuid>".
 *
 * Claim-once: COALESCE keeps whichever contact matched first. The webhook processes
 * messages fire-and-forget, so a template forwarded to a colleague can genuinely race
 * here; a plain assignment would be last-write-wins with nothing in the logs.
 */
export async function claimLeadByRequestId(
  requestId: string,
  contactId: string,
  payload: Record<string, unknown>,
  at: Date
): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [saved] = await tx
      .insert(leads)
      .values({ requestId, contactId, payload, submittedAt: at, matchedAt: at, firstContactAt: at })
      .onConflictDoUpdate({
        target: leads.requestId,
        targetWhere: sql`${leads.requestId} IS NOT NULL`,
        set: {
          contactId: sql`coalesce(${leads.contactId}, excluded.contact_id)`,
          matchedAt: sql`coalesce(${leads.matchedAt}, excluded.matched_at)`,
          // An imported row has no first contact until its customer writes - this message.
          firstContactAt: sql`coalesce(${leads.firstContactAt}, excluded.first_contact_at)`,
          payload: mergePayload(payload),
          updatedAt: new Date(),
        },
      })
      .returning({ id: leads.id, inserted: sql<boolean>`(xmax = 0)`, contactId: leads.contactId });
    if (saved && saved.contactId === contactId) await absorbOrganicLead(tx, saved.id, contactId);
    // Only a row this call created starts its history; a conflict update is an import's row
    // being claimed, and keeps whatever it already has.
    if (!saved?.inserted) return;
    // Dated by the message that created it (`at`), like the lead's own submitted_at.
    await insertLeadEvent(tx, {
      leadId: saved.id,
      fromStatus: null,
      toStatus: 'new',
      fromKind: null,
      toKind: null,
      actor: 'system',
      staffId: null,
      evidence: null,
      messageId: null,
      createdAt: at,
    });
  });
}

/**
 * A contact with a campaign lead never also has an organic one - but chakraSync imports a chat
 * newest first, so a plain message the customer sent AFTER the template can be imported before it
 * and create the organic lead first. On the 2026-11-10 production copy 6 customers had both open,
 * counted once as Organik and once as Campaign. The template wins: an untouched organic lead (still
 * new, no staff edit or staff kind, no deal) is folded into the campaign lead, which takes its earlier
 * first contact and its Hot/Cold. One that has moved on is left alone - it carries history of its own.
 */
async function absorbOrganicLead(tx: Tx, campaignLeadId: string, contactId: string): Promise<void> {
  const res = await tx.execute<{ id: string; first_contact_at: string | null; lead_temperature: string | null }>(sql`
    SELECT id, first_contact_at, lead_temperature FROM leads
    WHERE contact_id = ${contactId}::uuid AND request_id IS NULL AND previous_lead_id IS NULL
      AND status = 'new' AND kind = 'lead' AND human_updated_at IS NULL
      AND coalesce(kind_set_by, '') <> 'staff' AND deal_value_idr IS NULL AND total_orders = 0
      AND NOT EXISTS (SELECT 1 FROM leads r WHERE r.previous_lead_id = leads.id)
    FOR UPDATE
  `);
  const organic = res.rows[0];
  if (!organic) return;
  await tx.execute(sql`
    UPDATE leads SET
      first_contact_at = least(first_contact_at, ${organic.first_contact_at}::timestamptz),
      lead_temperature = coalesce(lead_temperature, ${organic.lead_temperature}),
      updated_at = now()
    WHERE id = ${campaignLeadId}::uuid
  `);
  await tx.execute(sql`DELETE FROM leads WHERE id = ${organic.id}::uuid`); // its events cascade
}

/**
 * The repair for leads created before absorbOrganicLead existed (scripts/repair-lead-sync-order.ts):
 * folds the contact's untouched organic lead into its earliest campaign lead. False when there is
 * nothing to fold.
 */
export async function absorbOrganicIntoCampaignLead(contactId: string): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const res = await tx.execute<{ id: string }>(sql`
      SELECT id FROM leads WHERE contact_id = ${contactId}::uuid AND request_id IS NOT NULL
      ORDER BY submitted_at ASC, id ASC LIMIT 1`);
    const campaign = res.rows[0];
    if (!campaign) return false;
    const before = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM leads WHERE contact_id = ${contactId}::uuid`);
    await absorbOrganicLead(tx, campaign.id, contactId);
    const after = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM leads WHERE contact_id = ${contactId}::uuid`);
    return after.rows[0]!.n < before.rows[0]!.n;
  });
}

/**
 * Writer 3 - an organic walk-in. ~96% of current traffic, and the baseline every campaign
 * is measured against.
 *
 * NOT EXISTS rather than a plain insert: a contact who already has a campaign lead must
 * not also get an organic one. uq_leads_organic_contact is the backstop against a race.
 */
export async function ensureOrganicLead(contactId: string, at: Date): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const res = await tx.execute<{ id: string }>(sql`
      INSERT INTO leads (contact_id, submitted_at, matched_at, first_contact_at)
      SELECT ${contactId}::uuid, ${at.toISOString()}::timestamptz, ${at.toISOString()}::timestamptz,
             ${at.toISOString()}::timestamptz
      WHERE NOT EXISTS (SELECT 1 FROM leads WHERE contact_id = ${contactId}::uuid)
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    const id = res.rows[0]?.id;
    if (!id) {
      await backdateFirstContact(tx, contactId, at);
      return;
    }
    // Dated by the message that created it (`at`), like the lead's own submitted_at.
    await insertLeadEvent(tx, {
      leadId: id,
      fromStatus: null,
      toStatus: 'new',
      fromKind: null,
      toKind: null,
      actor: 'system',
      staffId: null,
      evidence: null,
      messageId: null,
      createdAt: at,
    });
  });
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

/**
 * A message OLDER than the contact's lead: move the lead's start back to it. chakraSync imports a
 * chat newest message first, so the lead was created by whichever message came in first - on the
 * 2026-11-10 production copy 40 leads started at a later message than the customer's first, one
 * by 88 days, and sat in the wrong period of the report. Live messages arrive in order, so this
 * matches nothing for them.
 *
 * An organic lead moves whole - submitted_at, matched_at, first_contact_at and its creation event:
 * all three mean "the first message" for a walk-in. A campaign lead keeps submitted_at (the form)
 * and matched_at (the template) and moves first_contact_at only. A renewal never moves: its dates
 * are the return message that opened it, by design.
 */
async function backdateFirstContact(tx: Tx, contactId: string, at: Date): Promise<void> {
  const iso = at.toISOString();
  const moved = await tx.execute<{ id: string }>(sql`
    UPDATE leads SET
      first_contact_at = ${iso}::timestamptz,
      submitted_at = CASE WHEN request_id IS NULL THEN least(submitted_at, ${iso}::timestamptz) ELSE submitted_at END,
      matched_at = CASE WHEN request_id IS NULL THEN least(matched_at, ${iso}::timestamptz) ELSE matched_at END
    WHERE contact_id = ${contactId}::uuid AND previous_lead_id IS NULL
      AND first_contact_at > ${iso}::timestamptz
    RETURNING id
  `);
  if (moved.rows.length === 0) return;
  await tx.execute(sql`
    UPDATE lead_events SET created_at = ${iso}::timestamptz
    WHERE from_status IS NULL AND to_status = 'new' AND created_at > ${iso}::timestamptz
      AND lead_id IN (SELECT id FROM leads WHERE contact_id = ${contactId}::uuid AND previous_lead_id IS NULL AND request_id IS NULL)
  `);
}

/** request_ids already on file, so the import can report inserted vs updated honestly. */
export async function findExistingRequestIds(requestIds: string[]): Promise<Set<string>> {
  if (requestIds.length === 0) return new Set();
  const db = getDb();
  // inArray, not a raw `= ANY(${ids}::uuid[])`: drizzle expands a JS array in a sql template
  // into a comma-separated parameter list, which Postgres reads as a record, not an array.
  const rows = await db
    .select({ requestId: leads.requestId })
    .from(leads)
    .where(inArray(leads.requestId, requestIds));
  return new Set(rows.map((r) => r.requestId).filter((id): id is string => id !== null));
}

/**
 * The newest customer/bot row of any of the contact's chats; it is a wait only when it is the
 * customer's. Reads `leads.contact_id`, so the query must select FROM leads. Shared by the
 * unreplied filter in listLeads and the report's "Belum dibalas" block.
 */
export const WAITING_SINCE_SQL = sql<string | null>`(
  SELECT CASE WHEN m.role = 'user' THEN m.created_at END
  FROM messages m JOIN conversations cv ON cv.id = m.conversation_id
  WHERE cv.contact_id = ${leads.contactId} AND m.role IN ('user', 'assistant')
  ORDER BY m.created_at DESC
  LIMIT 1
)`;

/**
 * "Unreplied" is a work queue, not an archive: a customer who wrote a month ago and never got an
 * answer is a lost chat, not a reply to send now, and the restored history held mostly those.
 * Won/Lost leads stay in (a won buyer asking about delivery still needs an answer).
 */
export const UNREPLIED_MAX_AGE_DAYS = 7;

/** True when `waitingSince` (a WAITING_SINCE_SQL value) is a wait inside the window. */
export function isRecentWaitSql(waitingSince: SQL) {
  return sql`${waitingSince} >= now() - make_interval(days => ${UNREPLIED_MAX_AGE_DAYS})`;
}

// ─── readers ───────────────────────────────────────────────────────────────

const staffName = (col: AnyColumn) =>
  sql<string | null>`(SELECT ${staffProfiles.name} FROM ${staffProfiles} WHERE ${staffProfiles.id} = ${col})`;

function profileText(profile: unknown, key: string): string | null {
  const v = (profile as Record<string, unknown> | null)?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export async function listLeads(
  params: PaginationParams & {
    search?: string;
    campaign?: string;
    source?: string;
    status?: LeadStatus;
    startDate?: string;
    endDate?: string;
    brand?: BrandSlug;
    followUpStatus?: ContactProfileFollowUpStatus;
    kind?: LeadKind | 'non_lead';
    unreplied?: boolean;
    sort?: 'submitted' | 'chat_started' | 'last_chat';
    order?: 'asc' | 'desc';
    /** One lead by id, whatever its kind (the detail view). Skips the default kind filter. */
    id?: string;
  }
): Promise<{ items: LeadWithContact[]; total: number }> {
  const db = getDb();
  const offset = (params.page - 1) * params.limit;

  const waitingSinceExpr = WAITING_SINCE_SQL;

  const conditions = [...dateConditions(params)];
  if (params.id) {
    conditions.push(eq(leads.id, params.id));
  } else {
    conditions.push(
      params.kind === 'non_lead'
        ? sql`${leads.kind} <> 'lead'`
        : eq(leads.kind, params.kind ?? 'lead')
    );
  }
  if (params.unreplied) {
    conditions.push(isRecentWaitSql(waitingSinceExpr));
    conditions.push(IS_CURRENT_LEAD_SQL);
  }
  if (params.status) conditions.push(eq(leads.status, params.status));
  if (params.source) conditions.push(eq(leads.utmSource, params.source));
  if (params.brand) conditions.push(sql`${params.brand} = ANY(${leads.brands})`);
  if (params.followUpStatus) {
    conditions.push(eq(contactProfiles.followUpStatus, params.followUpStatus));
  }
  if (params.campaign) {
    // Must mirror CAMPAIGN_BUCKET_SQL exactly, or a label shown in the report wouldn't
    // filter to the rows it counted.
    conditions.push(
      params.campaign === ORGANIC_CAMPAIGN
        ? sql`${leads.requestId} IS NULL AND coalesce(${leads.utmCampaign}, '') = ''`
        : params.campaign === UNTAGGED_CAMPAIGN
          ? sql`${leads.requestId} IS NOT NULL AND coalesce(${leads.utmCampaign}, '') = ''`
          : eq(leads.utmCampaign, params.campaign)
    );
  }
  if (params.search) {
    const pattern = `%${params.search}%`;
    conditions.push(
      or(
        ilike(contacts.displayName, pattern),
        ilike(contacts.waId, pattern),
        // Both jsonb bags hold per-form / per-extraction keys, so search the values rather
        // than naming any one field.
        sql`exists (
          select 1 from jsonb_each_text(${leads.payload}) kv where kv.value ilike ${pattern}
        )`,
        sql`exists (
          select 1 from jsonb_each_text(coalesce(${contactProfiles.profile}, '{}'::jsonb)) kv
          where kv.value ilike ${pattern}
        )`
      )!
    );
  }
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Subqueries, not a join: a contact can own several conversations and a join would
  // duplicate the lead row (and break the count).
  const conversationIdExpr = sql<string | null>`(
    SELECT id FROM conversations
    WHERE conversations.contact_id = ${leads.contactId}
    ORDER BY updated_at DESC
    LIMIT 1
  )`;
  const conversationStatusExpr = sql<string | null>`(
    SELECT status FROM conversations
    WHERE conversations.contact_id = ${leads.contactId}
    ORDER BY updated_at DESC
    LIMIT 1
  )`;
  // When the thread actually began. Oldest conversation, not the latest-touched one the two
  // expressions above pick: "when did we start talking to this person" is the question, and a
  // second WhatsApp number opening a newer thread must not reset it.
  //
  // Typed string, not Date: a raw sql<> expression bypasses drizzle's column type mapping, so
  // pg hands the timestamptz back as text ('2026-09-11 11:56:34+07'). Converted in the mapper
  // below rather than left to every consumer to discover.
  const conversationStartedAtExpr = sql<string | null>`(
    SELECT created_at FROM conversations
    WHERE conversations.contact_id = ${leads.contactId}
    ORDER BY created_at ASC
    LIMIT 1
  )`;
  // The newest message either side wrote, in any of the contact's chats: what "Chat Terakhir" shows
  // and sorts by. System notes are the dashboard's own, not chat.
  const lastChatAtExpr = sql<string | null>`(
    SELECT max(m.created_at) FROM messages m JOIN conversations cv ON cv.id = m.conversation_id
    WHERE cv.contact_id = ${leads.contactId} AND m.role IN ('user', 'assistant')
  )`;
  const sortExpr =
    params.sort === 'last_chat' ? lastChatAtExpr
      : params.sort === 'chat_started' ? conversationStartedAtExpr
        : params.sort === 'submitted' ? sql`${leads.submittedAt}`
          : null;
  // A lead with no chat has no date to sort on: last in either direction, never first.
  const orderBy = sortExpr
    ? [params.order === 'asc' ? sql`${sortExpr} ASC NULLS LAST` : sql`${sortExpr} DESC NULLS LAST`, desc(leads.id)]
    // Unreplied: whoever has waited longest first.
    : params.unreplied ? [asc(waitingSinceExpr), desc(leads.submittedAt)] : [desc(leads.submittedAt)];

  const [rows, countResult] = await Promise.all([
    db
      .select({
        id: leads.id,
        requestId: leads.requestId,
        contactId: leads.contactId,
        utmId: leads.utmId,
        utmSource: leads.utmSource,
        utmMedium: leads.utmMedium,
        utmCampaign: leads.utmCampaign,
        utmTerm: leads.utmTerm,
        utmContent: leads.utmContent,
        payload: leads.payload,
        status: leads.status,
        dealValueIdr: leads.dealValueIdr,
        leadTemperature: leads.leadTemperature,
        totalOrders: leads.totalOrders,
        humanUpdatedAt: leads.humanUpdatedAt,
        statusSetBy: leads.statusSetBy,
        totalOrdersSetAt: leads.totalOrdersSetAt,
        totalOrdersSetBy: leads.totalOrdersSetBy,
        dealValueSetAt: leads.dealValueSetAt,
        dealValueSetBy: leads.dealValueSetBy,
        // Who set each locked field, for the dashboard's "manual" mark.
        statusSetByName: staffName(leads.statusSetBy),
        totalOrdersSetByName: staffName(leads.totalOrdersSetBy),
        dealValueSetByName: staffName(leads.dealValueSetBy),
        submittedAt: leads.submittedAt,
        matchedAt: leads.matchedAt,
        kind: leads.kind,
        kindSetBy: leads.kindSetBy,
        lostReason: leads.lostReason,
        outcomeEvidence: leads.outcomeEvidence,
        outcomeMessageId: leads.outcomeMessageId,
        closedAt: leads.closedAt,
        previousLeadId: leads.previousLeadId,
        firstContactAt: leads.firstContactAt,
        brands: leads.brands,
        items: leads.items,
        orderFieldsSetAt: leads.orderFieldsSetAt,
        orderFieldsSetBy: leads.orderFieldsSetBy,
        createdAt: leads.createdAt,
        updatedAt: leads.updatedAt,
        waId: contacts.waId,
        displayName: contacts.displayName,
        aiEnabled: contacts.aiEnabled,
        lastSeen: contacts.lastSeen,
        contactProfile: contactProfiles.profile,
        followUpStatus: contactProfiles.followUpStatus,
        followUpNotes: contactProfiles.followUpNotes,
        conversationId: conversationIdExpr,
        conversationStatus: conversationStatusExpr,
        conversationStartedAt: conversationStartedAtExpr,
        lastChatAt: lastChatAtExpr,
        waitingSince: waitingSinceExpr,
      })
      .from(leads)
      // @ts-ignore drizzle-orm dual-module resolution
      .leftJoin(contacts, eq(contacts.id, leads.contactId))
      // @ts-ignore drizzle-orm dual-module resolution
      .leftJoin(contactProfiles, eq(contactProfiles.contactId, leads.contactId))
      .where(whereClause)
      .orderBy(...orderBy)
      // limit 0 = every matching row, same escape hatch listProducts uses for the catalog
      // export. The route schemas still cap the paginated list at 100.
      .limit(params.limit === 0 ? Number.MAX_SAFE_INTEGER : params.limit)
      .offset(params.limit === 0 ? 0 : offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(leads)
      // @ts-ignore drizzle-orm dual-module resolution
      .leftJoin(contacts, eq(contacts.id, leads.contactId))
      // @ts-ignore drizzle-orm dual-module resolution
      .leftJoin(contactProfiles, eq(contactProfiles.contactId, leads.contactId))
      .where(whereClause),
  ]);

  const items = rows.map((row) => ({
    ...mapLead(row),
    waId: row.waId ?? null,
    displayName: row.displayName ?? null,
    conversationId: row.conversationId ?? null,
    conversationStatus: (row.conversationStatus as ConversationStatus | null) ?? null,
    conversationStartedAt: row.conversationStartedAt
      ? new Date(row.conversationStartedAt)
      : null,
    lastChatAt: row.lastChatAt ? new Date(row.lastChatAt) : null,
    statusSetByName: row.statusSetByName ?? null,
    totalOrdersSetByName: row.totalOrdersSetByName ?? null,
    dealValueSetByName: row.dealValueSetByName ?? null,
    name: profileText(row.contactProfile, 'name'),
    company: profileText(row.contactProfile, 'business_name'),
    contactProfile: (row.contactProfile as Record<string, unknown>) ?? {},
    followUpStatus: (row.followUpStatus as ContactProfileFollowUpStatus | null) ?? null,
    followUpNotes: row.followUpNotes ?? null,
    aiEnabled: row.aiEnabled ?? null,
    lastSeen: row.lastSeen ?? null,
    waitingSince: row.waitingSince ? new Date(row.waitingSince) : null,
  }));

  return { items, total: countResult[0]?.count ?? 0 };
}

/** One lead with its contact, profile and waiting state - the same row `listLeads` builds. */
export async function getLeadWithContact(id: string): Promise<LeadWithContact | null> {
  const { items } = await listLeads({ page: 1, limit: 1, id });
  return items[0] ?? null;
}

/** A lead as stored, any kind; null when there is none. */
export async function getLeadById(id: string): Promise<Lead | null> {
  const db = getDb();
  const [row] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  return row ? mapLead(row) : null;
}

/**
 * The campaign report. Raw SQL because a correlated-EXISTS filtered count doesn't express
 * cleanly in the query builder.
 *
 * `escalated` uses EXISTS rather than a join to conversations: a contact with two
 * conversations (two WhatsApp numbers) would otherwise multiply all of its lead rows.
 */
export async function getCampaignSummary(params: {
  startDate?: string;
  endDate?: string;
}): Promise<LeadCampaignSummary[]> {
  const db = getDb();

  const start = params.startDate ? wibDayStart(params.startDate) : null;
  let end = params.endDate ? wibDayStart(params.endDate) : null;
  if (end) end.setUTCDate(end.getUTCDate() + 1);

  const result = await db.execute<{
    campaign: string;
    source: string | null;
    leads: number;
    chats: number;
    escalated: number;
    won: number;
    lost: number;
    deal_value: string | null;
  }>(sql`
    SELECT
      ${CAMPAIGN_BUCKET_SQL}                                               AS campaign,
      max(utm_source)                                                      AS source,
      count(*)::int                                                        AS leads,
      count(contact_id)::int                                               AS chats,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM conversations c
        WHERE c.contact_id = leads.contact_id AND c.status = 'escalated'))::int AS escalated,
      count(*) FILTER (WHERE status = 'won')::int                          AS won,
      count(*) FILTER (WHERE status = 'lost')::int                         AS lost,
      coalesce(sum(deal_value_idr) FILTER (WHERE status = 'won'), 0)       AS deal_value
    FROM leads
    WHERE kind = 'lead'
      ${start ? sql`AND submitted_at >= ${start.toISOString()}::timestamptz` : sql``}
      ${end ? sql`AND submitted_at < ${end.toISOString()}::timestamptz` : sql``}
    GROUP BY 1
    ORDER BY leads DESC, campaign ASC
  `);

  return result.rows.map((r) => ({
    campaign: r.campaign,
    source: r.source,
    leads: Number(r.leads),
    chats: Number(r.chats),
    escalated: Number(r.escalated),
    won: Number(r.won),
    lost: Number(r.lost),
    dealValueIdr: Number(r.deal_value ?? 0),
  }));
}

export interface LeadCampaignFields {
  utmId?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
}

// The lead half of /new. The row survives with request_id, utm_* and payload intact - that is
// marketing's attribution, not conversation state, and re-importing their export must stay a
// no-op. Only the sales state a human or the flow set is rewound. Deliberately not reachable
// from upsertLeadFromImport: an import must never reset anyone's Won/Lost, only this command,
// typed by hand from a whitelisted phone, may.
export async function resetLeadsForContact(contactId: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    // Every lead of the contact except an older Lost organic lead (a renewed customer's): that
    // one stays as it is, because rewinding it would make a second open organic lead beside the
    // current one, which uq_leads_organic_open_contact refuses - after the context reset had
    // already happened. An organic lead that is already open can always be rewound, current or
    // not (a newer campaign lead is current): it stays the one open organic lead.
    const target = and(
      eq(leads.contactId, contactId),
      sql`NOT (${leads.status} = 'lost' AND ${leads.requestId} IS NULL AND ${leads.id} <> ${currentLeadIdSql(contactId)})`
    );
    // Locked first: the event's from_status must be the status that is actually rewound.
    const before = await tx.select({ id: leads.id, status: leads.status }).from(leads)
      .where(target).for('update');
    if (before.length === 0) return;
    await tx
      .update(leads)
      .set({
        status: 'new',
        dealValueIdr: null,
        leadTemperature: null,
        totalOrders: 0,
        // The outcome goes with the status it described.
        closedAt: null,
        lostReason: null,
        outcomeEvidence: null,
        outcomeMessageId: null,
        // Clearing the locks as well, or the AI would stay muted on a thread it is being
        // asked to judge from scratch.
        humanUpdatedAt: null,
        statusSetBy: null,
        totalOrdersSetAt: null,
        totalOrdersSetBy: null,
        dealValueSetAt: null,
        dealValueSetBy: null,
        orderFieldsSetAt: null,
        orderFieldsSetBy: null,
        updatedAt: new Date(),
      })
      .where(inArray(leads.id, before.map((l) => l.id)));
    await tx.delete(leadOrders).where(inArray(leadOrders.leadId, before.map((l) => l.id)));
    for (const l of before) {
      if (l.status === 'new') continue;
      await insertLeadEvent(tx, {
        leadId: l.id,
        fromStatus: l.status as LeadStatus,
        toStatus: 'new',
        fromKind: null,
        toKind: null,
        actor: 'system',
        staffId: null,
        evidence: '/new reset',
        messageId: null,
      });
    }
  });
}

/** patchLead's answer when the change would give the contact a second open organic lead. */
export const LEAD_ALREADY_OPEN = 'LEAD_ALREADY_OPEN' as const;

function isOrganicOpenConflict(err: unknown): boolean {
  for (let e = err as { code?: string; constraint?: string; cause?: unknown } | undefined, i = 0; e && i < 3; i++) {
    if (e.code === '23505' && e.constraint === 'uq_leads_organic_open_contact') return true;
    e = e.cause as typeof e;
  }
  return false;
}

export async function patchLead(
  id: string,
  updates: LeadCampaignFields & {
    status?: LeadStatus;
    dealValueIdr?: number | null;
    totalOrders?: number;
    kind?: LeadKind;
    lostReason?: LostReason | null;
    brands?: BrandSlug[];
    items?: OrderItem[];
    staffId?: string;
  }
): Promise<Lead | null | typeof LEAD_ALREADY_OPEN> {
  try {
    return await patchLeadTx(id, updates);
  } catch (err) {
    // Reopening a renewed customer's old Lost organic lead while their new one is open. The
    // transaction has rolled back, so nothing was written.
    if (isOrganicOpenConflict(err)) return LEAD_ALREADY_OPEN;
    throw err;
  }
}

async function patchLeadTx(
  id: string,
  updates: Parameters<typeof patchLead>[1]
): Promise<Lead | null> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(leads).where(eq(leads.id, id)).for('update');
    if (!before) return null;

    // Only the keys actually sent are written, so the campaign modal and the inline status
    // dropdown can't overwrite each other's fields.
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.status !== undefined) {
      set['status'] = updates.status;
      const closing = updates.status === 'won' || updates.status === 'lost';
      if (updates.status !== before.status) {
        // A new status is staff's own decision: the previous outcome's proof, reason and date
        // described a different status and go with it.
        set['closedAt'] = closing ? new Date() : null;
        set['outcomeEvidence'] = null;
        set['outcomeMessageId'] = null;
        set['lostReason'] = null;
      } else {
        set['closedAt'] = closing ? (before.closedAt ?? new Date()) : null;
        if (updates.status !== 'lost') set['lostReason'] = null;
      }
    }
    if (updates.lostReason !== undefined && (updates.status ?? before.status) === 'lost') {
      set['lostReason'] = updates.lostReason;
    }
    if (updates.kind !== undefined) {
      set['kind'] = updates.kind;
      set['kindSetBy'] = 'staff';
    }
    // Each field staff set is locked against the AI on its own, and remembers who set it - the
    // dashboard marks it "manual". Client 2026-11-10: one edit used to freeze all three, so a typed
    // deal value also stopped the stages and the order count. Campaign-field edits lock nothing:
    // they are attribution, not sales state.
    const now = new Date();
    const by = updates.staffId ?? null;
    if (updates.status !== undefined) {
      set['humanUpdatedAt'] = now;
      set['statusSetBy'] = by;
    }
    if (updates.dealValueIdr !== undefined) {
      set['dealValueIdr'] = updates.dealValueIdr === null ? null : String(updates.dealValueIdr);
      set['dealValueSetAt'] = now;
      set['dealValueSetBy'] = by;
    }
    if (updates.totalOrders !== undefined) {
      set['totalOrders'] = updates.totalOrders;
      set['totalOrdersSetAt'] = now;
      set['totalOrdersSetBy'] = by;
    }
    // Staff's list replaces what the AI collected, and locks it against the next lead pass.
    if (updates.brands !== undefined || updates.items !== undefined) {
      if (updates.brands !== undefined) set['brands'] = updates.brands;
      if (updates.items !== undefined) set['items'] = updates.items;
      set['orderFieldsSetAt'] = now;
      set['orderFieldsSetBy'] = by;
    }
    for (const key of ['utmId', 'utmSource', 'utmMedium', 'utmCampaign', 'utmTerm', 'utmContent'] as const) {
      if (updates[key] !== undefined) set[key] = updates[key];
    }

    const [row] = await tx.update(leads).set(set).where(eq(leads.id, id)).returning();

    const statusChanged = updates.status !== undefined && updates.status !== before.status;
    const kindChanged = updates.kind !== undefined && updates.kind !== before.kind;
    if (statusChanged || kindChanged) {
      await insertLeadEvent(tx, {
        leadId: id,
        fromStatus: statusChanged ? (before.status as LeadStatus) : null,
        toStatus: statusChanged ? updates.status! : null,
        fromKind: kindChanged ? (before.kind as LeadKind) : null,
        toKind: kindChanged ? updates.kind! : null,
        actor: 'staff',
        staffId: updates.staffId ?? null,
        evidence: null,
        messageId: null,
      });
    }
    return row ? mapLead(row) : null;
  });
}

// ─── the current lead, and writing stages ──────────────────────────────────

// A contact can own several leads (two ads, a returning customer). The live conversation
// belongs to the newest one that is not Lost; if all are Lost, the newest Lost. One fragment
// The order is one shared fragment (CURRENT_LEAD_ORDER) used by every "current lead" query below,
// so the readers, applyAiLeadUpdate and the unreplied filters cannot disagree. Its columns are
// unqualified: they bind to the innermost `leads` in each subquery.
const CURRENT_LEAD_ORDER = sql`(status = 'lost') ASC, submitted_at DESC, id DESC`;

function currentLeadIdSql(contactId: string) {
  return sql`(
    SELECT id FROM leads WHERE contact_id = ${contactId}::uuid
    ORDER BY ${CURRENT_LEAD_ORDER} LIMIT 1
  )`;
}

// The same rule as currentLeadIdSql (same CURRENT_LEAD_ORDER), for a query that is already
// FROM leads: true only on the row that is its contact's current lead. A renewed customer has an
// old Lost lead and a new one; "waiting for a reply" belongs to the new one alone.
export const IS_CURRENT_LEAD_SQL = sql`leads.id = (
  SELECT cl.id FROM leads cl WHERE cl.contact_id = leads.contact_id
  ORDER BY ${CURRENT_LEAD_ORDER} LIMIT 1
)`;

export async function findCurrentLeadForContact(contactId: string): Promise<Lead | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(leads)
    .where(sql`${leads.id} = ${currentLeadIdSql(contactId)}`)
    .limit(1);
  return row ? mapLead(row) : null;
}

/**
 * When the lead's current lifecycle began: its latest return from Lost (a lost -> open event,
 * dated by the message that brought the customer back), else its first contact. Messages before
 * it belong to a lifecycle that already ended and prove nothing about this one.
 */
export async function getLeadLifecycleStart(leadId: string): Promise<Date | null> {
  const { rows } = await getDb().execute<{ start: string | Date | null }>(sql`
    SELECT coalesce(
      (SELECT max(e.created_at) FROM lead_events e
        WHERE e.lead_id = l.id AND e.from_status = 'lost' AND e.to_status IS NOT NULL AND e.to_status <> 'lost'),
      l.first_contact_at, l.matched_at, l.submitted_at
    ) AS start
    FROM leads l WHERE l.id = ${leadId}::uuid`);
  const start = rows[0]?.start;
  return start ? new Date(start) : null;
}

export interface LeadStageChange {
  kind?: LeadKind;
  kindSetBy?: 'ai' | 'rule';
  status?: LeadStatus;
  evidence?: string;
  messageId?: string;
  lostReason?: LostReason;
  actor: LeadActor;
  /** When no message proves the change (closeSilentLeads): the time it happened, as SQL. */
  at?: SQL;
}

/**
 * The one place the AI pass and rules write a lead's stage or kind. Row-locked, one
 * transaction, one lead_events row for the change. Returns whether anything changed.
 *
 * Staff edits always win: a kind staff set is never rewritten, and a status is never written
 * once human_updated_at is set. Stages only move forward (canAdvance), so a Won lead never
 * changes by itself. Staff edits go through patchLead.
 *
 * The kind is named only while the lead is still being qualified (new / contacted), for the rule
 * as for the AI: a buyer past Penawaran or Won who writes "sudah transfer" or "cek resi" is
 * chasing their own order, and re-kinding them status_pesanan would drop a real deal out of
 * /leads, the report and the Won count - with no AI write able to undo it. Checked here, under the
 * row lock, so a status that moved since the caller read the lead still counts.
 */
export async function applyLeadStage(leadId: string, change: LeadStageChange): Promise<boolean> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(leads).where(eq(leads.id, leadId)).for('update');
    if (!row) return false;

    const set: Record<string, unknown> = {};
    const kindChanges =
      change.kind !== undefined && row.kindSetBy !== 'staff' && change.kind !== row.kind &&
      (row.status === 'new' || row.status === 'contacted');
    if (kindChanges) {
      set['kind'] = change.kind;
      set['kindSetBy'] = change.kindSetBy ?? 'ai';
    }
    const statusChanges =
      change.status !== undefined &&
      row.humanUpdatedAt === null &&
      canAdvance(row.status as LeadStatus, change.status);
    // A change proven by a message is dated by that message (messages carry their WhatsApp send
    // time), not by when the pass ran: a backfill would otherwise close every past deal on the run
    // day, the reopen window would start from it, and a Penawaran stamped today would sort after a
    // Won dated last month. Copied in SQL, so closed_at equals the message's created_at to the
    // microsecond and the post-close transcript cut (created_at > closed_at) excludes it.
    const provenAt = change.messageId ? messageTimeSql(change.messageId) : change.at;
    if (statusChanges) {
      set['status'] = change.status;
      if (change.status === 'won' || change.status === 'lost') {
        set['closedAt'] = provenAt ?? new Date();
        set['outcomeEvidence'] = change.evidence ?? null;
        set['outcomeMessageId'] = change.messageId ?? null;
        set['lostReason'] = change.status === 'lost' ? (change.lostReason ?? null) : null;
      }
    }
    if (!kindChanges && !statusChanges) return false;

    set['updatedAt'] = new Date();
    await tx.update(leads).set(set).where(eq(leads.id, leadId));
    await insertLeadEvent(tx, {
      leadId,
      fromStatus: statusChanges ? (row.status as LeadStatus) : null,
      toStatus: statusChanges ? change.status! : null,
      fromKind: kindChanges ? (row.kind as LeadKind) : null,
      toKind: kindChanges ? change.kind! : null,
      actor: change.actor,
      staffId: null,
      evidence: change.evidence ?? null,
      messageId: change.messageId ?? null,
      createdAt: provenAt,
    });
    return true;
  });
}

/**
 * A customer wrote again after their lead was Lost. Within the window the same lead goes back
 * to Contacted (its history stays one story); after it, a fresh organic lead is opened and
 * linked to the old one. A lead staff closed is never reopened (its decision stands inside the window) but still renews after it; the old lead is not modified. `evidence` is the message that
 * brought them back.
 */
export async function reopenOrRenewLostLead(
  lead: Lead,
  reopenAfterDays: number,
  evidence: { body: string; messageId: string }
): Promise<Lead> {
  if (lead.status !== 'lost') return lead;
  const db = getDb();
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(leads).where(eq(leads.id, lead.id)).for('update');
    if (!row || row.status !== 'lost') {
      return row ? mapLead(row) : lead;
    }
    // The window runs from the close to the message that brought them back, not to now: a
    // backfill run weeks later must reach the same verdict the live pass would have.
    const backAt = messageTimeSql(evidence.messageId);
    const { rows: [gap] } = await tx.execute<{ within: boolean }>(sql`
      SELECT extract(epoch FROM ${backAt} - coalesce(closed_at, updated_at)) <= ${reopenAfterDays} * 86400 AS within
      FROM leads WHERE id = ${row.id}::uuid`);
    // No response is never reopened: whoever writes after it is a new lead (client, 2026-11-13).
    const withinWindow = gap?.within === true && row.lostReason !== 'tidak_ada_respon';
    const event = {
      fromStatus: 'lost' as LeadStatus | null,
      toStatus: 'contacted' as LeadStatus | null,
      fromKind: null,
      toKind: null,
      actor: 'ai' as LeadActor,
      staffId: null,
      evidence: evidence.body,
      messageId: evidence.messageId,
      // Dated by the message that brought them back, like every event a message proves.
      createdAt: backAt,
    };

    if (withinWindow) {
      // Staff closed this lead: their decision stands inside the window.
      if (row.humanUpdatedAt !== null) return mapLead(row);
      const [reopened] = await tx
        .update(leads)
        .set({
          status: 'contacted',
          closedAt: null,
          lostReason: null,
          outcomeEvidence: null,
          outcomeMessageId: null,
          updatedAt: new Date(),
        })
        .where(eq(leads.id, row.id))
        .returning();
      await insertLeadEvent(tx, { ...event, leadId: row.id });
      return mapLead(reopened!);
    }

    // A racing turn already opened a new lead: use it.
    const [open] = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.contactId, row.contactId!), sql`${leads.status} <> 'lost'`))
      .limit(1);
    if (open) return mapLead(open);

    // The new lifecycle starts at the return message, like an organic lead at its first message:
    // a backfilled renewal lands in the right report day and its time to close stays >= 0.
    const [created] = await tx
      .insert(leads)
      .values({
        contactId: row.contactId,
        previousLeadId: row.id,
        status: 'contacted',
        submittedAt: backAt,
        matchedAt: backAt,
        firstContactAt: backAt,
      })
      .returning();
    await insertLeadEvent(tx, { ...event, leadId: created!.id, fromStatus: null });
    return mapLead(created!);
  });
}

/**
 * Records the customer messages that placed an order (the lead-insights pass, each one a verified
 * customer message) and recounts total_orders - unless staff set the count by hand. One row per
 * message, so re-reading the same chat never counts an order twice. Each row is dated by its
 * message, copied in SQL. Returns how many orders are new.
 */
export async function recordLeadOrders(
  leadId: string,
  orders: { messageId: string; evidence: string }[]
): Promise<number> {
  if (orders.length === 0) return 0;
  return getDb().transaction(async (tx) => {
    let added = 0;
    for (const o of orders) {
      const res = await tx.execute(sql`
        INSERT INTO lead_orders (lead_id, message_id, evidence, created_at)
        SELECT ${leadId}::uuid, m.id, ${o.evidence}, m.created_at FROM messages m WHERE m.id = ${o.messageId}::uuid
        ON CONFLICT (lead_id, message_id) DO NOTHING
      `);
      added += res.rowCount ?? 0;
    }
    if (added > 0) {
      await tx.execute(sql`
        UPDATE leads SET total_orders = (SELECT count(*)::int FROM lead_orders WHERE lead_id = ${leadId}::uuid), updated_at = now()
        WHERE id = ${leadId}::uuid AND total_orders_set_at IS NULL
      `);
    }
    return added;
  });
}

/** The orders recorded for a lead, oldest first - the proof behind its Total Order. */
export async function listLeadOrders(leadId: string): Promise<{ id: string; messageId: string | null; evidence: string; createdAt: Date }[]> {
  return getDb()
    .select({ id: leadOrders.id, messageId: leadOrders.messageId, evidence: leadOrders.evidence, createdAt: leadOrders.createdAt })
    .from(leadOrders)
    .where(eq(leadOrders.leadId, leadId))
    .orderBy(asc(leadOrders.createdAt));
}

/**
 * The AI's half of a lead row, applied once per turn from what the model reported.
 *
 * Two rules make this safe to run on every reply:
 *
 *  - It is an UPDATE, never an INSERT. `recordLeadFromMessage` runs in messageRouter above
 *    the AI gate, so a lead always exists by the time insights fire; if one somehow doesn't,
 *    updating zero rows is the right no-op rather than creating a lead with no provenance.
 *  - Staff win per field. Once staff typed the deal value (`deal_value_set_at`) the model never
 *    writes it again. Temperature is a badge with no input, so it is always written.
 *
 * Deal value accumulates rather than being restated: the model sees one turn, so it can
 * report the order in front of it but not a running total. The order COUNT is not written here
 * any more - the lead-insights pass counts orders from the customer's own messages
 * (recordLeadOrders), and a second counter would count the same order twice.
 */
export async function applyAiLeadUpdate(
  contactId: string,
  patch: {
    temperature?: LeadTemperature;
    /** true on the turn the customer first commits to an order. */
    orderConfirmed?: boolean;
    /** Rupiah total for that one order, not a running total. */
    orderValueIdr?: number;
  }
): Promise<void> {
  const temperature = patch.temperature ?? null;
  // The order COUNT is the lead-insights pass's alone (recordLeadOrders), from the customer's own
  // order messages: a second counter here would count the same order twice.
  const orderValue = patch.orderConfirmed ? (patch.orderValueIdr ?? null) : null;

  if (!temperature && orderValue === null) return;

  const db = getDb();
  // The newest lead for this contact: a contact can own several campaign leads (two ads,
  // two months) and the live conversation belongs to the most recent submission.
  await db.execute(sql`
    UPDATE leads SET
      lead_temperature = coalesce(${temperature}::text, lead_temperature),
      deal_value_idr = CASE
        WHEN deal_value_set_at IS NULL AND ${orderValue}::numeric IS NOT NULL
          THEN coalesce(deal_value_idr, 0) + ${orderValue}::numeric
        ELSE deal_value_idr END,
      updated_at = now()
    WHERE id = ${currentLeadIdSql(contactId)}
  `);
}


function mapLead(row: typeof leads.$inferSelect): Lead {
  return {
    id: row.id,
    requestId: row.requestId,
    contactId: row.contactId,
    utmId: row.utmId,
    utmSource: row.utmSource,
    utmMedium: row.utmMedium,
    utmCampaign: row.utmCampaign,
    utmTerm: row.utmTerm,
    utmContent: row.utmContent,
    payload: (row.payload as Record<string, unknown>) ?? {},
    status: row.status as LeadStatus,
    // numeric comes back from pg as a string - the column holds rupiah, which fits a
    // double comfortably, so a plain Number() is safe here.
    dealValueIdr: row.dealValueIdr === null ? null : Number(row.dealValueIdr),
    leadTemperature: (row.leadTemperature as LeadTemperature | null) ?? null,
    totalOrders: row.totalOrders,
    humanUpdatedAt: row.humanUpdatedAt,
    statusSetBy: row.statusSetBy ?? null,
    totalOrdersSetAt: row.totalOrdersSetAt ?? null,
    totalOrdersSetBy: row.totalOrdersSetBy ?? null,
    dealValueSetAt: row.dealValueSetAt ?? null,
    dealValueSetBy: row.dealValueSetBy ?? null,
    brands: (row.brands ?? []) as BrandSlug[],
    items: (row.items ?? []) as OrderItem[],
    orderFieldsSetAt: row.orderFieldsSetAt ?? null,
    orderFieldsSetBy: row.orderFieldsSetBy ?? null,
    submittedAt: row.submittedAt,
    matchedAt: row.matchedAt,
    kind: row.kind as LeadKind,
    kindSetBy: (row.kindSetBy as LeadKindSetBy | null) ?? null,
    lostReason: (row.lostReason as LostReason | null) ?? null,
    outcomeEvidence: row.outcomeEvidence,
    outcomeMessageId: row.outcomeMessageId,
    closedAt: row.closedAt,
    previousLeadId: row.previousLeadId,
    firstContactAt: row.firstContactAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * The deterministic non-sales detector (courier, job seeker, payment follow-up, supplier) has
 * handed this chat to the team: tag the lead's kind at once, by rule - only while the lead is new
 * or contacted, and never over a kind staff set (both in applyLeadStage). The hand-off reply itself
 * does not depend on it. Fire-and-forget from messageRouter; no lead yet is not an error.
 */
export async function tagNonSalesLead(contactId: string, topic: string): Promise<void> {
  const lead = await findCurrentLeadForContact(contactId);
  if (!lead) return;
  await applyLeadStage(lead.id, {
    kind: kindFromNonSalesTopic(topic),
    kindSetBy: 'rule',
    actor: 'system',
    evidence: topic,
  });
}

/**
 * Closes every open lead whose customer has not answered our last message for `days` days: Lost,
 * reason tidak_ada_respon, actor system (client, 2026-11-13: "for no response between the threshold,
 * it will be lost"). No model call - the rule is the message times.
 *
 * - Only kind 'lead' in new / contacted / quoted; a lead staff set the status of is left alone
 *   (applyLeadStage skips it), and Won never changes.
 * - "Our last message" is the newest user/assistant row of the contact's chats (system notes do not
 *   count), and it must be ours - bot or staff. A customer whose own message is the last one is
 *   waiting on US, and that is the unreplied list, never Lost.
 * - Not when that message is a hand-off ("kami cek dengan tim dulu", metadata source escalation /
 *   escalation_ack) or a promise the team keeps (the design examples line, the PO form line while
 *   its link is not set - CANNED_PO_FORM_FROM_TEAM), and not while that chat is escalated or taken
 *   over: the customer is waiting on the team, and silence there is ours (final review M7). The PO
 *   form link itself is the bot's last word like any reply.
 * - closed_at and the event are dated when the threshold passed (last message + days), computed in
 *   SQL to the microsecond, not the day the sweep ran: a first sweep after deploy closes months of
 *   stale leads, and each must land in its own report period. That also starts the reopen window
 *   there, so a customer who comes back is reopened or renewed by the usual rule.
 *
 * Returns the leads it closed (or would close, with dryRun).
 */
export async function closeSilentLeads(
  days: number,
  opts: { dryRun?: boolean; /** Tests: only these contacts' leads. */ contactIds?: string[] } = {}
): Promise<{ leadId: string; lastAt: string }[]> {
  if (!Number.isInteger(days) || days < 1) return [];
  const db = getDb();
  const { rows } = await db.execute<{ lead_id: string; last_at: string; closes_at: string }>(sql`
    SELECT l.id AS lead_id, m.created_at::text AS last_at,
           (m.created_at + make_interval(days => ${days}))::text AS closes_at
    FROM leads l
    JOIN LATERAL (
      SELECT msg.role, msg.created_at, msg.metadata, msg.body, c.status AS conv_status
      FROM messages msg JOIN conversations c ON c.id = msg.conversation_id
      WHERE c.contact_id = l.contact_id AND msg.role IN ('user', 'assistant')
      ORDER BY msg.created_at DESC LIMIT 1
    ) m ON true
    WHERE l.kind = 'lead'
      AND l.status IN ('new', 'contacted', 'quoted')
      AND l.human_updated_at IS NULL
      AND m.role = 'assistant'
      AND coalesce(m.metadata->>'source', '') NOT IN ('escalation', 'escalation_ack', 'design_examples')
      AND NOT (coalesce(m.metadata->>'source', '') = 'po_form' AND m.body = ${CANNED_PO_FORM_FROM_TEAM})
      AND m.conv_status NOT IN ('escalated', 'needs_human')
      AND m.created_at < now() - make_interval(days => ${days})
      ${opts.contactIds ? sql`AND l.contact_id IN (${sql.join(opts.contactIds.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``}
    ORDER BY m.created_at`);
  if (opts.dryRun) return rows.map((r) => ({ leadId: r.lead_id, lastAt: r.last_at }));
  const closed: { leadId: string; lastAt: string }[] = [];
  for (const r of rows) {
    const changed = await applyLeadStage(r.lead_id, {
      status: 'lost',
      lostReason: 'tidak_ada_respon',
      actor: 'system',
      at: sql`${r.closes_at}::timestamptz`,
    });
    if (changed) closed.push({ leadId: r.lead_id, lastAt: r.last_at });
  }
  return closed;
}

/**
 * Writes what one lead pass read of the chat. Brands are a union. Items are the pass's snapshot: each
 * pass reads the whole transcript and returns the full list, so merging them additively collected
 * near-duplicates ("kertas nasi" 30x30 in one pass, "Kertas Supreme 64 gsm" 30x30 in the next - two
 * lines). The snapshot replaces the items, each keeping the fields it does not restate from the same
 * item (product + size, mergeOrderFacts' key) already on the lead. An empty snapshot keeps the items:
 * a pass that read nothing must not wipe them. A lead staff set by hand (order_fields_set_at) is left
 * alone. The row is locked while it is read and written, so two passes cannot interleave.
 */
export async function applyLeadOrderSnapshot(
  leadId: string,
  snapshot: { brands: BrandSlug[]; items: OrderItem[] },
): Promise<void> {
  await getDb().transaction(async (tx) => {
    const [row] = await tx.select({ brands: leads.brands, items: leads.items, lockedAt: leads.orderFieldsSetAt }).from(leads).where(eq(leads.id, leadId)).for('update');
    if (!row || row.lockedAt) return; // staff set these by hand: the AI no longer adds to them
    const brands = mergeOrderFacts({ brands: row.brands }, { brands: snapshot.brands })['brands'] as string[];
    const fresh = mergeOrderFacts({}, { items: snapshot.items })['items'] as OrderItem[];
    let items = row.items as unknown[];
    if (fresh.length > 0) {
      // The old item under each fresh key, patched with what the pass read (mergeOrderFacts' item rules).
      const old = (Array.isArray(row.items) ? row.items : []) as OrderItem[];
      items = fresh.map((item) => {
        const prior = old.find((o) => o && typeof o === 'object' && itemKey(o) === itemKey(item));
        return prior ? (mergeOrderFacts({ items: [prior] }, { items: [item] })['items'] as OrderItem[])[0]! : item;
      });
    }
    await tx.update(leads).set({ brands, items, updatedAt: new Date() }).where(eq(leads.id, leadId));
  });
}
