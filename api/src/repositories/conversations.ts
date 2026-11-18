import { eq, asc, desc, and, sql, inArray, type SQL } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { conversations, messages, contacts, contactProfiles, phoneNumbers, conversationReads } from '../db/schema.js';
import type { Conversation, Message, ConversationStatus, PaginationParams } from '../domain/types.js';
import type { HandoffCategory } from '../domain/handoff.js';
import type { BrandSlug } from '../domain/orderProfile.js';
import { contactHeadline } from '../domain/orderDetails.js';
import { CANNED_PO_FORM_FROM_TEAM } from '../domain/constants.js';
import { MESSAGE_SOURCE } from '../domain/messageSources.js';

// When the conversation was actually handed to a human. escalateConversation writes exactly one
// message tagged source='escalation' per hand-off, so its timestamp is the real one - and it is
// already there for every historical row, no column needed. conversations.updated_at cannot
// stand in: updateConversationFollowUp bumps it from inside saveConversationInsights, which runs
// on ordinary turns, so a rotting escalation kept looking minutes old.
// The `m` alias is deliberate - see the warning on lastMessageAtExpr below.
const escalatedAtExpr = sql<Date | null>`(
  SELECT MAX(m.created_at) FROM messages m
  WHERE m.conversation_id = conversations.id AND m.metadata->>'source' = 'escalation'
)`;

// The AI's memory floor - /new stamps conversations.context_reset_at and everything at or below
// it becomes invisible to the model while staying in the dashboard thread. It lives here, in the
// repository, rather than at the call sites: getLastNMessages alone has four callers, and one
// that forgot the floor would silently leak pre-reset history back into a turn.
// A scalar subquery with no outer references, so Postgres evaluates it once as an InitPlan and
// can still use idx_messages_conversation(conversation_id, created_at) for the range.
const afterContextReset = (conversationId: string) => sql`
  ${messages.createdAt} > coalesce(
    (SELECT c.context_reset_at FROM conversations c WHERE c.id = ${conversationId}),
    '-infinity'::timestamptz
  )`;

export async function findConversationById(id: string): Promise<(Conversation & { escalatedAt: Date | null; contact?: { id: string; waId: string; displayName: string | null; aiEnabled: boolean | null; firstSeen: Date; lastSeen: Date }; phoneNumber?: { id: string; number: string; label: string | null } }) | null> {
  const db = getDb();
  const [row] = await db
    .select({
      id: conversations.id,
      contactId: conversations.contactId,
      phoneNumberId: conversations.phoneNumberId,
      status: conversations.status,
      escalationReason: conversations.escalationReason,
      assignedAgent: conversations.assignedAgent,
      handoffCategory: conversations.handoffCategory,
      conversationSummary: conversations.conversationSummary,
      followUpNotes: conversations.followUpNotes,
      teamNotes: conversations.teamNotes,
      teamNotesUpdatedAt: conversations.teamNotesUpdatedAt,
      teamNotesUpdatedBy: conversations.teamNotesUpdatedBy,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
      contactWaId: contacts.waId,
      contactDisplayName: contacts.displayName,
      contactAiEnabled: contacts.aiEnabled,
      contactFirstSeen: contacts.firstSeen,
      contactLastSeen: contacts.lastSeen,
      phoneNumber: phoneNumbers.number,
      phoneLabel: phoneNumbers.label,
      escalatedAt: escalatedAtExpr,
    })
    .from(conversations)
    // @ts-ignore drizzle-orm dual-module resolution
    .leftJoin(contacts, eq(conversations.contactId, contacts.id))
    // @ts-ignore drizzle-orm dual-module resolution
    .leftJoin(phoneNumbers, eq(conversations.phoneNumberId, phoneNumbers.id))
    .where(eq(conversations.id, id))
    .limit(1);

  if (!row) return null;

  return {
    ...mapConversation(row),
    escalatedAt: row.escalatedAt ? new Date(row.escalatedAt) : null,
    contact: row.contactWaId
      ? { id: row.contactId, waId: row.contactWaId, displayName: row.contactDisplayName, aiEnabled: row.contactAiEnabled, firstSeen: row.contactFirstSeen!, lastSeen: row.contactLastSeen! }
      : undefined,
    phoneNumber: row.phoneNumber
      ? { id: row.phoneNumberId, number: row.phoneNumber, label: row.phoneLabel }
      : undefined,
  };
}

export async function findConversationByContactAndPhone(
  contactId: string,
  phoneNumberId: string
): Promise<Conversation | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.contactId, contactId),
        eq(conversations.phoneNumberId, phoneNumberId)
      )
    )
    .limit(1);
  return row ? mapConversation(row) : null;
}

export async function upsertConversation(
  contactId: string,
  phoneNumberId: string
): Promise<Conversation> {
  const db = getDb();
  const existing = await findConversationByContactAndPhone(contactId, phoneNumberId);
  if (existing) return existing;

  const [row] = await db
    .insert(conversations)
    .values({ contactId, phoneNumberId, status: 'active' })
    .returning();

  if (!row) throw new Error('Failed to create conversation');
  return mapConversation(row);
}

export type ConversationView = 'team' | 'ai' | 'resolved';

/** The statuses behind each inbox tab (Perlu tim / Dibalas AI / Selesai). */
const VIEW_STATUSES: Record<ConversationView, ConversationStatus[]> = {
  team: ['escalated', 'needs_human'],
  ai: ['active'],
  resolved: ['resolved'],
};

export interface ConversationListRow extends Conversation {
  contact?: { id: string; waId: string; displayName: string | null };
  phoneNumber?: { id: string; number: string; label: string | null };
  unread: boolean;
  lastMessageAt: Date;
  escalatedAt: Date | null;
  /** The name the bot collected (profile `name`), else the WhatsApp display name. */
  customerName: string | null;
  businessName: string | null;
  /** Brands discussed (profile `brands`), known slugs only. */
  brands: BrandSlug[];
  lastMessage: { body: string; role: string; senderName: string | null } | null;
  /** When the PO form link last went to the customer. */
  poFormSentAt: Date | null;
}

// The newest message of any role - the same row lastMessageAtExpr times, so the preview and its
// time agree. The `m` alias is deliberate - see the warning on lastMessageAtExpr below.
const lastMessageExpr = sql<{ body: string; role: string; senderName: string | null } | null>`(
  SELECT json_build_object('body', m.body, 'role', m.role, 'senderName', m.sender_name)
  FROM messages m WHERE m.conversation_id = conversations.id
  ORDER BY m.created_at DESC, m.id DESC LIMIT 1
)`;

// The PO form LINK reaching the customer. While the link setting is still the placeholder the bot
// sends CANNED_PO_FORM_FROM_TEAM instead - a promise that the team will send the form - under the
// same source, so that line is told apart by its fixed text, as closeSilentLeads does.
const poFormSentAtExpr = sql<Date | null>`(
  SELECT MAX(m.created_at) FROM messages m
  WHERE m.conversation_id = conversations.id
    AND m.metadata->>'source' = ${MESSAGE_SOURCE.poForm}
    AND m.body <> ${CANNED_PO_FORM_FROM_TEAM}
)`;

/** A LIKE pattern for `s` anywhere, taken literally: %, _ and \ escaped with the ESCAPE character \. */
function containsPattern(s: string): string {
  return `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function listConversations(
  params: PaginationParams & { status?: ConversationStatus; agentId?: string; upsellAccepted?: boolean; view?: ConversationView; search?: string }
): Promise<{ items: ConversationListRow[]; total: number; counts: { all: number; team: number; ai: number; resolved: number } }> {
  const db = getDb();
  const offset = (params.page - 1) * params.limit;

  // When the last message actually arrived from WhatsApp. NOT conversations.updated_at —
  // that is a row mtime, only written on status/follow-up changes, so an active chat's time
  // would sit frozen at whenever the row was created while messages kept coming in.
  // Backed by idx_messages_conversation (conversation_id, created_at), so MAX is an index scan.
  // Identifiers written out rather than interpolated: drizzle only table-qualifies an
  // interpolated column when the query has a join, and `messages` has its own `id`, so an
  // unqualified render would bind to messages.id, match nothing, and silently fall back to
  // created_at for every row. The `m` alias makes that impossible to get wrong.
  const lastMessageAtExpr = sql<Date>`COALESCE(
    (SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = conversations.id),
    conversations.created_at
  )`;

  // What the tabs count: the search (and the upsell filter), never the tab itself, so each tab
  // says how many matches it holds.
  const base: SQL[] = [];
  if (params.upsellAccepted === true) {
    base.push(sql`EXISTS (
      SELECT 1 FROM contact_profiles cp
      WHERE cp.contact_id = ${conversations.contactId}
      AND cp.profile->>'upsell_accepted' = 'true'
    )`);
  }
  const search = params.search?.trim();
  if (search) {
    const pattern = containsPattern(search);
    base.push(sql`(
      ${contacts.waId} ILIKE ${pattern} ESCAPE '\\'
      OR ${contacts.displayName} ILIKE ${pattern} ESCAPE '\\'
      OR ${contactProfiles.profile}->>'name' ILIKE ${pattern} ESCAPE '\\'
      OR ${contactProfiles.profile}->>'business_name' ILIKE ${pattern} ESCAPE '\\'
    )`);
  }
  // What the page lists: the tab and the status filter on top.
  const narrow: SQL[] = [];
  if (params.status) narrow.push(eq(conversations.status, params.status));
  if (params.view) narrow.push(inArray(conversations.status, VIEW_STATUSES[params.view]));
  const whereClause = base.length + narrow.length > 0 ? and(...base, ...narrow) : undefined;
  const narrowed = narrow.length > 0 ? and(...narrow)! : sql`true`;

  const agentId = params.agentId ?? '';
  const unreadExpr = agentId
    ? sql<boolean>`(
        COALESCE(
          (SELECT last_read_at FROM conversation_reads
           WHERE conversation_id = ${conversations.id} AND agent_id = ${agentId}),
          '-infinity'::timestamptz
        ) < COALESCE(
          (SELECT MAX(created_at) FROM messages WHERE conversation_id = ${conversations.id}),
          '-infinity'::timestamptz
        )
      )`
    : sql<boolean>`false`;

  const [rows, countResult] = await Promise.all([
    db
      .select({
        id: conversations.id,
        contactId: conversations.contactId,
        phoneNumberId: conversations.phoneNumberId,
        status: conversations.status,
        escalationReason: conversations.escalationReason,
        assignedAgent: conversations.assignedAgent,
        handoffCategory: conversations.handoffCategory,
        conversationSummary: conversations.conversationSummary,
        followUpNotes: conversations.followUpNotes,
        teamNotes: conversations.teamNotes,
        teamNotesUpdatedAt: conversations.teamNotesUpdatedAt,
        teamNotesUpdatedBy: conversations.teamNotesUpdatedBy,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
        contactWaId: contacts.waId,
        contactDisplayName: contacts.displayName,
        phoneNumber: phoneNumbers.number,
        phoneLabel: phoneNumbers.label,
        profile: contactProfiles.profile,
        unread: unreadExpr,
        lastMessageAt: lastMessageAtExpr,
        escalatedAt: escalatedAtExpr,
        lastMessage: lastMessageExpr,
        poFormSentAt: poFormSentAtExpr,
      })
      .from(conversations)
      // @ts-ignore drizzle-orm dual-module resolution
      .leftJoin(contacts, eq(conversations.contactId, contacts.id))
      // @ts-ignore drizzle-orm dual-module resolution
      .leftJoin(phoneNumbers, eq(conversations.phoneNumberId, phoneNumbers.id))
      // @ts-ignore drizzle-orm dual-module resolution
      .leftJoin(contactProfiles, eq(contactProfiles.contactId, conversations.contactId))
      .where(whereClause)
      // Sort by the same value the UI shows, or the list looks shuffled. The escalation queue
      // shows (and promises) time-since-hand-off, so it sorts by that: sorting it by last
      // message put the conversations being actively complained into at the TOP of a list
      // labelled "paling lama di atas", which is how one sat unanswered for twenty hours.
      .orderBy(params.status === 'escalated' ? asc(escalatedAtExpr) : desc(lastMessageAtExpr))
      .limit(params.limit)
      .offset(offset),
    // The same joins as the page, so the search reads the same columns.
    db
      .select({
        total: sql<number>`(count(*) FILTER (WHERE ${narrowed}))::int`,
        all: sql<number>`count(*)::int`,
        team: sql<number>`(count(*) FILTER (WHERE ${inArray(conversations.status, VIEW_STATUSES.team)}))::int`,
        ai: sql<number>`(count(*) FILTER (WHERE ${inArray(conversations.status, VIEW_STATUSES.ai)}))::int`,
        resolved: sql<number>`(count(*) FILTER (WHERE ${inArray(conversations.status, VIEW_STATUSES.resolved)}))::int`,
      })
      .from(conversations)
      // @ts-ignore drizzle-orm dual-module resolution
      .leftJoin(contacts, eq(conversations.contactId, contacts.id))
      // @ts-ignore drizzle-orm dual-module resolution
      .leftJoin(contactProfiles, eq(contactProfiles.contactId, conversations.contactId))
      .where(base.length > 0 ? and(...base) : undefined),
  ]);

  const items: ConversationListRow[] = rows.map((row) => ({
    ...mapConversation(row),
    contact: row.contactWaId
      ? { id: row.contactId, waId: row.contactWaId, displayName: row.contactDisplayName }
      : undefined,
    phoneNumber: row.phoneNumber
      ? { id: row.phoneNumberId, number: row.phoneNumber, label: row.phoneLabel }
      : undefined,
    unread: row.unread,
    lastMessageAt: new Date(row.lastMessageAt),
    escalatedAt: row.escalatedAt ? new Date(row.escalatedAt) : null,
    ...contactHeadline(row.profile, row.contactDisplayName),
    lastMessage: row.lastMessage ?? null,
    poFormSentAt: row.poFormSentAt ? new Date(row.poFormSentAt) : null,
  }));

  const c = countResult[0];
  return {
    items,
    total: c?.total ?? 0,
    counts: { all: c?.all ?? 0, team: c?.team ?? 0, ai: c?.ai ?? 0, resolved: c?.resolved ?? 0 },
  };
}

/** A chat waiting on the team, as the Perlu Tim queue reads it. */
export interface HeldConversationRow {
  id: string;
  status: 'escalated' | 'needs_human';
  handoffCategory: HandoffCategory | null;
  assignedAgent: string | null;
  waId: string;
  displayName: string | null;
  profile: unknown;
  waitingSince: Date;
}

/**
 * Every chat waiting on the team (escalated or needs_human), oldest wait first. The wait starts at the
 * hand-off message (escalatedAtExpr); a chat staff took before any hand-off has none and falls back to
 * the row's updated_at. `assignedTo`: only the chats that person holds.
 */
export async function listHeldConversations(opts: { assignedTo?: string } = {}): Promise<HeldConversationRow[]> {
  const db = getDb();
  const waitingSinceExpr = sql<string>`COALESCE(${escalatedAtExpr}, conversations.updated_at)`;
  const conditions: SQL[] = [inArray(conversations.status, VIEW_STATUSES.team)];
  if (opts.assignedTo) conditions.push(eq(conversations.assignedAgent, opts.assignedTo));
  const rows = await db
    .select({
      id: conversations.id,
      status: conversations.status,
      handoffCategory: conversations.handoffCategory,
      assignedAgent: conversations.assignedAgent,
      waId: contacts.waId,
      displayName: contacts.displayName,
      profile: contactProfiles.profile,
      waitingSince: waitingSinceExpr,
    })
    .from(conversations)
    // @ts-ignore drizzle-orm dual-module resolution
    .leftJoin(contacts, eq(conversations.contactId, contacts.id))
    // @ts-ignore drizzle-orm dual-module resolution
    .leftJoin(contactProfiles, eq(contactProfiles.contactId, conversations.contactId))
    .where(and(...conditions))
    .orderBy(asc(waitingSinceExpr), asc(conversations.id));

  return rows.map((r) => ({
    id: r.id,
    status: r.status as HeldConversationRow['status'],
    handoffCategory: (r.handoffCategory as HandoffCategory | null) ?? null,
    assignedAgent: r.assignedAgent,
    waId: r.waId ?? '',
    displayName: r.displayName ?? null,
    profile: r.profile ?? null,
    waitingSince: new Date(r.waitingSince),
  }));
}

/**
 * Escalated conversations that were handed off before `before` and are still sitting there.
 *
 * Separate from listConversations because this is a background sweep, not a page: no paging, no
 * joins, no unread bookkeeping - just the ids and how long they have been waiting. Ordered so
 * the nudge always names the oldest first, which is the same order the escalations queue uses.
 */
export async function listStaleEscalations(
  before: Date
): Promise<{ id: string; escalationReason: string | null; escalatedAt: Date }[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: conversations.id,
      escalationReason: conversations.escalationReason,
      escalatedAt: escalatedAtExpr,
    })
    .from(conversations)
    .where(and(eq(conversations.status, 'escalated'), sql`${escalatedAtExpr} < ${before}`))
    .orderBy(asc(escalatedAtExpr));

  return rows
    .filter((r): r is typeof r & { escalatedAt: Date } => r.escalatedAt != null)
    .map((r) => ({ ...r, escalatedAt: new Date(r.escalatedAt) }));
}

export async function upsertConversationRead(conversationId: string, agentId: string): Promise<void> {
  const db = getDb();
  await db
    .insert(conversationReads)
    .values({ conversationId, agentId, lastReadAt: new Date() })
    .onConflictDoUpdate({
      target: [conversationReads.conversationId, conversationReads.agentId],
      set: { lastReadAt: sql`now()` },
    });
}

export async function updateConversationStatus(
  id: string,
  status: ConversationStatus,
  escalationReason?: string,
  assignedAgent?: string,
  handoffCategory?: HandoffCategory
): Promise<Conversation | null> {
  const db = getDb();
  // A caller that names no reason means "leave it alone", not "clear it". The dashboard PATCH
  // never sends one, so treating undefined as null wiped the reason on take-over - the one
  // action whose whole point is to read it. Only leaving the held state for good drops it, and
  // the hand-off category with it.
  const leavingHeldState = status === 'active' || status === 'resolved';
  const [row] = await db
    .update(conversations)
    .set({
      status,
      escalationReason: escalationReason !== undefined ? escalationReason : (leavingHeldState ? null : undefined),
      handoffCategory: handoffCategory !== undefined ? handoffCategory : (leavingHeldState ? null : undefined),
      // Back to the AI, nobody holds the chat: the router stays silent on any assigned chat, and a
      // staff reply records its sender here (markHumanTakeover), so "Kembalikan ke AI" must clear it.
      assignedAgent: assignedAgent ?? (status === 'active' ? null : undefined),
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, id))
    .returning();
  return row ? mapConversation(row) : null;
}

export async function getConversationMessages(conversationId: string): Promise<Message[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt);
  return rows.map(mapMessage);
}

// Insert a message with ON CONFLICT DO NOTHING on wa_message_id. Returns the inserted
// message, or null if the waMessageId already exists — a duplicate webhook delivery, or a
// message the ChakraHQ history sync has already seen (the webhook tells those apart with
// claimSyncedInbound). The unique index on wa_message_id is the only dedup mechanism, so both
// writers must come through here.
// createdAt is explicit for backfilled history; live traffic omits it and gets now().
export async function insertMessageIfNew(data: {
  conversationId: string;
  role: string;
  body: string;
  waMessageId: string;
  status?: string;
  senderName?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
}): Promise<Message | null> {
  const db = getDb();
  const [row] = await db
    .insert(messages)
    .values(data)
    .onConflictDoNothing({ target: messages.waMessageId })
    .returning();
  return row ? mapMessage(row) : null;
}

/**
 * The webhook's second chance when insertMessageIfNew finds the wamid taken: was the row written
 * by chakraSync, which never answers anything? Then this inbound message has not been routed yet,
 * and the webhook takes it over - the row becomes what the webhook would have inserted (its body
 * and metadata, the sync's `source` dropped) and is returned. A row the webhook wrote itself, or
 * one an earlier delivery already took over, returns null: that is a real duplicate.
 *
 * Before this, "the wamid exists" was read as "already handled". The per-reply sync runs seconds
 * after the customer's previous message, so a message typed during a turn could be imported before
 * its own webhook was processed, and the bot never answered it. Not "has it been replied to": a
 * reply to the earlier batch is stored after this message's send time and would read as an answer.
 *
 * One UPDATE, so of two deliveries racing here exactly one gets the row: the loser waits on the row
 * lock, re-reads it with `source` gone, and matches nothing.
 */
export async function claimSyncedInbound(data: {
  conversationId: string;
  waMessageId: string;
  body: string;
  metadata?: Record<string, unknown>;
}): Promise<Message | null> {
  const db = getDb();
  const patch = { ...data.metadata, syncedFirst: true };
  const [row] = await db
    .update(messages)
    .set({
      body: data.body,
      metadata: sql`(COALESCE(${messages.metadata}, '{}'::jsonb) - 'source') || ${JSON.stringify(patch)}::jsonb`,
    })
    .where(and(
      eq(messages.waMessageId, data.waMessageId),
      eq(messages.conversationId, data.conversationId),
      eq(messages.role, 'user'),
      sql`${messages.metadata}->>'source' = 'chakra_sync'`,
    ))
    .returning();
  return row ? mapMessage(row) : null;
}

/** Merges keys into a message's metadata (jsonb), keeping the rest. */
export async function mergeMessageMetadata(id: string, patch: Record<string, unknown>): Promise<void> {
  const db = getDb();
  await db
    .update(messages)
    .set({ metadata: sql`COALESCE(${messages.metadata}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb` })
    .where(eq(messages.id, id));
}

// Pull a conversation's start date back to its oldest backfilled message. Only created_at:
// updated_at is a row mtime and nothing user-facing reads it — the inbox time and its sort
// both come from the real last-message time (see lastMessageAtExpr in listConversations).
// Writing updated_at here would stamp every imported chat with the import time and float
// months-old conversations to the top of the inbox as "1m ago".
export async function backdateConversation(id: string, minTs: Date): Promise<void> {
  const db = getDb();
  await db
    .update(conversations)
    .set({ createdAt: sql`LEAST(${conversations.createdAt}, ${minTs.toISOString()}::timestamptz)` })
    .where(eq(conversations.id, id));
}

export async function insertMessage(data: {
  conversationId: string;
  role: string;
  body: string;
  waMessageId?: string;
  status?: string;
  senderName?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
}): Promise<Message> {
  const db = getDb();
  const [row] = await db.insert(messages).values(data).returning();
  if (!row) throw new Error('Failed to insert message');
  return mapMessage(row);
}

/** `since`: only rows newer than it (on top of the context-reset floor, which always applies). */
/** `since` may be a SQL timestamp (a column read in the query) where a JS Date would drop microseconds. */
export async function getLastNMessages(conversationId: string, n: number, since?: Date | SQL): Promise<Message[]> {
  const db = getDb();
  const floor = since instanceof Date ? sql`${since.toISOString()}::timestamptz` : since;
  const rows = await db
    .select()
    .from(messages)
    .where(and(
      eq(messages.conversationId, conversationId),
      afterContextReset(conversationId),
      ...(floor ? [sql`${messages.createdAt} > ${floor}`] : []),
    ))
    .orderBy(desc(messages.createdAt))
    .limit(n);
  return rows.reverse().map(mapMessage);
}

export async function findMessageByWaMessageId(waMessageId: string): Promise<Message | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(messages)
    .where(eq(messages.waMessageId, waMessageId))
    .limit(1);
  return row ? mapMessage(row) : null;
}

export async function getConversationSummary(conversationId: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ conversationSummary: conversations.conversationSummary })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  return row?.conversationSummary ?? null;
}

// `since` is when the summarization job started. Summarizing awaits a full Claude call, so a
// /new landing inside that window would otherwise let the job write a summary of pre-reset
// messages back over the null the reset just wrote - silently un-resetting the conversation
// forever, since the summary is replayed into every turn. Stale job, no rows updated.
export async function updateConversationSummary(
  conversationId: string,
  summary: string,
  since: Date
): Promise<void> {
  const db = getDb();
  await db
    .update(conversations)
    .set({ conversationSummary: summary })
    .where(and(
      eq(conversations.id, conversationId),
      sql`coalesce(${conversations.contextResetAt}, '-infinity'::timestamptz) <= ${since.toISOString()}::timestamptz`
    ));
}

export async function countConversationMessages(conversationId: string): Promise<number> {
  const db = getDb();
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), afterContextReset(conversationId)));
  return result?.count ?? 0;
}

export async function getMessagesForSummary(conversationId: string, keepRecent: number): Promise<Message[]> {
  const total = await countConversationMessages(conversationId);
  const summarizeCount = total - keepRecent;
  if (summarizeCount <= 0) return [];

  const db = getDb();
  const rows = await db
    .select()
    .from(messages)
    // Floored, and countConversationMessages above is floored too - they must agree. Flooring
    // only the count would leave summarizeCount restarting from ~0 while this SELECT still took
    // the oldest messages of all time, writing pre-reset history straight back into
    // conversation_summary, which is replayed into every turn. The reset would undo itself.
    .where(and(eq(messages.conversationId, conversationId), afterContextReset(conversationId)))
    .orderBy(messages.createdAt)
    .limit(summarizeCount);
  return rows.map(mapMessage);
}

export async function updateConversationFollowUp(
  id: string,
  followUpNotes: string | null
): Promise<void> {
  const db = getDb();
  await db
    .update(conversations)
    .set({ followUpNotes, updatedAt: new Date() })
    .where(eq(conversations.id, id));
}

export async function resetConversationToActive(id: string): Promise<Conversation | null> {
  const db = getDb();
  const [row] = await db
    .update(conversations)
    // The whole hand-off goes: reason, category, and who held it (the router stays silent on an assigned chat).
    .set({ status: 'active', escalationReason: null, handoffCategory: null, assignedAgent: null, updatedAt: new Date() })
    .where(eq(conversations.id, id))
    .returning();
  return row ? mapConversation(row) : null;
}

// The write half of /new: everything the AI carries between turns about this thread. The message
// rows stay - they are still the dashboard's history, and chakraSync would re-import them anyway
// (it dedups on wa_message_id and re-stamps the original WhatsApp timestamps), which a floor
// survives and a delete does not. conversation_summary must be nulled explicitly: it is prose,
// not a message row, so no floor can hide it.
/**
 * `at`: the floor. Pass the /new message's own WhatsApp send time: created_at is backdated to that
 * clock for every inbound message, so a floor at processing time put a message sent a second
 * AFTER /new - but timestamped before the command was processed - under it (a setup line like
 * "halo, saya Budi, mau box nasi" vanished from the next turn's history).
 */
export async function resetConversationContext(id: string, at?: Date): Promise<void> {
  const db = getDb();
  await db
    .update(conversations)
    .set({
      contextResetAt: at ?? sql`now()`,
      conversationSummary: null,
      followUpNotes: null,
      status: 'active',
      escalationReason: null,
      handoffCategory: null,
      assignedAgent: null,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, id));
}

export interface TestConversationListItem {
  id: string;
  phoneNumberLabel: string | null;
  phoneNumberId: string;
  status: ConversationStatus;
  messageCount: number;
  updatedAt: Date;
}

export async function listTestConversations(): Promise<TestConversationListItem[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: conversations.id,
      phoneNumberId: conversations.phoneNumberId,
      phoneNumberLabel: phoneNumbers.label,
      status: conversations.status,
      updatedAt: conversations.updatedAt,
      messageCount: sql<number>`(
        SELECT COUNT(*) FROM messages WHERE messages.conversation_id = ${conversations.id}
      )::int`,
    })
    .from(conversations)
    // @ts-ignore drizzle-orm dual-module resolution
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    // @ts-ignore drizzle-orm dual-module resolution
    .innerJoin(phoneNumbers, eq(conversations.phoneNumberId, phoneNumbers.id))
    .where(eq(contacts.waId, 'test-kc-demo'))
    .orderBy(desc(conversations.updatedAt));

  return rows.map((r) => ({
    id: r.id,
    phoneNumberLabel: r.phoneNumberLabel ?? null,
    phoneNumberId: r.phoneNumberId,
    status: r.status as ConversationStatus,
    messageCount: r.messageCount,
    updatedAt: r.updatedAt,
  }));
}

// context_reset_at is omitted deliberately: it is AI plumbing, read only by afterContextReset's
// subquery, and no consumer of the domain Conversation has any use for it. Omitting it here
// keeps the hand-written .select() projections above from having to list it.
function mapConversation(row: Omit<typeof conversations.$inferSelect, 'contextResetAt' | 'insightsExtractedAt'>): Conversation {
  return {
    id: row.id,
    contactId: row.contactId,
    phoneNumberId: row.phoneNumberId,
    status: row.status as ConversationStatus,
    escalationReason: row.escalationReason,
    assignedAgent: row.assignedAgent,
    handoffCategory: (row.handoffCategory as HandoffCategory | null) ?? null,
    conversationSummary: row.conversationSummary ?? null,
    followUpNotes: row.followUpNotes ?? null,
    teamNotes: row.teamNotes ?? null,
    teamNotesUpdatedAt: row.teamNotesUpdatedAt ?? null,
    teamNotesUpdatedBy: row.teamNotesUpdatedBy ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapMessage(row: typeof messages.$inferSelect): Message {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role as Message['role'],
    body: row.body,
    waMessageId: row.waMessageId,
    status: row.status,
    senderName: row.senderName,
    metadata: row.metadata as Record<string, unknown> | null,
    createdAt: row.createdAt,
  };
}

/**
 * Conversations whose customer has written since the lead-insights pass last read them, and has
 * then been quiet for a while - so the pass never reads a chat the live bot is still in the middle
 * of. Newest first, so today's leads fill before the backfill of older ones.
 */
export async function listConversationsDueForInsights(
  quietSince: Date,
  limit: number,
  opts: { ignoreWatermark?: boolean; since?: Date; conversationIds?: string[] } = {}
): Promise<{ id: string; contactId: string; lastCustomerAt: Date; insightsExtractedAt: Date | null }[]> {
  const db = getDb();
  // Normal: a customer message newer than the watermark. Backfill (ignoreWatermark): every chat whose
  // watermark is null or older than `since` (no `since` = every chat), however old its last message.
  const due = opts.ignoreWatermark
    ? opts.since
      ? sql`(c.insights_extracted_at IS NULL OR c.insights_extracted_at < ${opts.since.toISOString()}::timestamptz)`
      : sql`true`
    : sql`max(m.created_at) > coalesce(c.insights_extracted_at, '-infinity'::timestamptz)`;
  // Only these chats, when given: re-reading one conversation, and the tests (which share a DB
  // holding real chats and other test files' rows, so "the newest due chat" is not theirs).
  const only = opts.conversationIds
    ? opts.conversationIds.length === 0
      ? sql`WHERE false`
      : sql`WHERE c.id IN (${sql.join(opts.conversationIds.map((id) => sql`${id}::uuid`), sql`, `)})`
    : sql``;
  const result = await db.execute<{ id: string; contact_id: string; last_customer_at: string | Date; insights_extracted_at: string | Date | null }>(sql`
    SELECT c.id, c.contact_id, max(m.created_at) AS last_customer_at, c.insights_extracted_at
    FROM conversations c
    JOIN messages m ON m.conversation_id = c.id AND m.role = 'user'
    ${only}
    GROUP BY c.id
    HAVING ${due}
       AND max(m.created_at) < ${quietSince.toISOString()}::timestamptz
    ORDER BY max(m.created_at) DESC
    LIMIT ${limit}
  `);
  return result.rows.map((r) => ({
    id: r.id,
    contactId: r.contact_id,
    lastCustomerAt: new Date(r.last_customer_at),
    // The watermark before this pass: a Lost lead's return is the first customer message after it.
    insightsExtractedAt: r.insights_extracted_at ? new Date(r.insights_extracted_at) : null,
  }));
}

/**
 * The newest customer message the pass has read; a later one makes the conversation due again.
 *
 * Stamped with that message's own created_at, read back in SQL: the Date the pass holds has
 * milliseconds and Postgres keeps microseconds, so stamping the Date put the watermark up to 999 µs
 * BEFORE the message it stands for. That message then stayed "newer than the watermark" forever:
 * on the 2026-11-10 production copy 20 chats were re-read on every sweep, a model call each, and five
 * leads had their kind flipped 191 times in a day (one 50 times) as the model wavered on thin chats.
 * GREATEST keeps a later stamp (a backfill's `since`) as it is.
 */
export async function markInsightsExtracted(conversationId: string, lastCustomerAt: Date): Promise<void> {
  const db = getDb();
  const stamp = lastCustomerAt.toISOString();
  await db
    .update(conversations)
    .set({
      insightsExtractedAt: sql`GREATEST(${stamp}::timestamptz, (
        SELECT max(m.created_at) FROM messages m
        WHERE m.conversation_id = ${conversationId}::uuid AND m.role = 'user'
          AND m.created_at < ${stamp}::timestamptz + interval '1 millisecond'
      ))`,
    })
    .where(eq(conversations.id, conversationId));
}

/**
 * A bot reply stored without its wamid (the send threw after WhatsApp accepted it) with this exact
 * text, sent around `at`. chakraSync asks before importing an outbound text as a staff reply.
 */
/** Which of these wamids are already stored - one query, so a sync can skip them before any download. */
export async function existingWaMessageIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const db = getDb();
  const rows = await db
    .select({ id: messages.waMessageId })
    .from(messages)
    .where(inArray(messages.waMessageId, ids));
  return new Set(rows.map((r) => r.id).filter((id): id is string => id !== null));
}

export async function hasUnlinkedAssistantTwin(conversationId: string, body: string, at: Date): Promise<boolean> {
  const db = getDb();
  const from = new Date(at.getTime() - 10 * 60_000);
  const to = new Date(at.getTime() + 10 * 60_000);
  const [row] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(
      eq(messages.conversationId, conversationId),
      eq(messages.role, 'assistant'),
      sql`${messages.waMessageId} IS NULL`,
      eq(messages.body, body),
      sql`${messages.createdAt} BETWEEN ${from.toISOString()}::timestamptz AND ${to.toISOString()}::timestamptz`,
    ))
    .limit(1);
  return row !== undefined;
}

/**
 * Outbound rows chakraSync imported, by wamid - the history repair (chakraSync.repairOutboundFiles)
 * re-reads Chakra for these, since the stored row keeps neither the sent link nor the media id.
 */
export async function findSyncedOutboundRows(
  waMessageIds: string[]
): Promise<{ id: string; conversationId: string; waMessageId: string; body: string; senderName: string | null; metadata: Record<string, unknown>; createdAt: Date }[]> {
  if (waMessageIds.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      waMessageId: messages.waMessageId,
      body: messages.body,
      senderName: messages.senderName,
      metadata: messages.metadata,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(and(
      inArray(messages.waMessageId, waMessageIds),
      eq(messages.role, 'assistant'),
      sql`${messages.metadata}->>'source' = 'chakra_sync'`,
    ));
  return rows.map((r) => ({ ...r, waMessageId: r.waMessageId ?? '', metadata: (r.metadata as Record<string, unknown>) ?? {} }));
}

/** Sets a synced row's sender and merges file fields into its metadata. */
export async function patchSyncedOutboundRow(
  id: string,
  patch: { senderName: string | null; metadata: Record<string, unknown> }
): Promise<void> {
  const db = getDb();
  await db
    .update(messages)
    .set({ senderName: patch.senderName, metadata: sql`coalesce(${messages.metadata}, '{}'::jsonb) || ${JSON.stringify(patch.metadata)}::jsonb` })
    .where(eq(messages.id, id));
}
