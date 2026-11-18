import { asc, eq, sql, type SQL } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { leadEvents } from '../db/schema.js';
import type { LeadActor, LeadEvent, LeadKind, LeadStatus } from '../domain/types.js';

/** A drizzle transaction, or the db itself: anything that can insert. */
export type DbTx = Pick<ReturnType<typeof getDb>, 'insert'>;

/**
 * A stage event's time when it carries a message: that message's `created_at`, copied in SQL so it
 * keeps its microseconds (a JS Date would drop them). now() if the message is gone.
 */
export function messageTimeSql(messageId: string): SQL {
  return sql`coalesce((SELECT m.created_at FROM messages m WHERE m.id = ${messageId}::uuid), now())`;
}

/**
 * Written in the same transaction as the lead change it describes. `createdAt` defaults to now;
 * a change proven by a message passes `messageTimeSql` so a backfill dates it when it happened.
 */
export async function insertLeadEvent(
  tx: DbTx,
  e: Omit<LeadEvent, 'id' | 'createdAt'> & { createdAt?: Date | SQL }
): Promise<void> {
  await tx.insert(leadEvents).values({
    leadId: e.leadId,
    fromStatus: e.fromStatus,
    toStatus: e.toStatus,
    fromKind: e.fromKind,
    toKind: e.toKind,
    actor: e.actor,
    staffId: e.staffId,
    evidence: e.evidence,
    messageId: e.messageId,
    ...(e.createdAt ? { createdAt: e.createdAt } : {}),
  });
}

// Two events of one pass can share a message's time (a returning customer whose only message is
// also the "saya ambil"); the funnel order then decides, not the random uuid.
const FUNNEL_RANK = sql`CASE ${leadEvents.toStatus}
  WHEN 'new' THEN 0 WHEN 'contacted' THEN 1 WHEN 'quoted' THEN 2 WHEN 'won' THEN 3 WHEN 'lost' THEN 3 ELSE 0 END`;

/** A lead's history, oldest first. */
export async function listLeadEvents(leadId: string): Promise<LeadEvent[]> {
  const rows = await getDb()
    .select()
    .from(leadEvents)
    .where(eq(leadEvents.leadId, leadId))
    .orderBy(asc(leadEvents.createdAt), asc(FUNNEL_RANK), asc(leadEvents.id));
  return rows.map((r) => ({
    id: r.id,
    leadId: r.leadId,
    fromStatus: (r.fromStatus as LeadStatus | null) ?? null,
    toStatus: (r.toStatus as LeadStatus | null) ?? null,
    fromKind: (r.fromKind as LeadKind | null) ?? null,
    toKind: (r.toKind as LeadKind | null) ?? null,
    actor: r.actor as LeadActor,
    staffId: r.staffId,
    evidence: r.evidence,
    messageId: r.messageId,
    createdAt: r.createdAt,
  }));
}
