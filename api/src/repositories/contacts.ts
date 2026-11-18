import { eq, desc, and, or, ilike, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { contacts, contactProfiles } from '../db/schema.js';
import type {
  Contact,
  ContactWithProfile,
  ContactProfileFollowUpStatus,
  CustomerType,
  PaginationParams,
} from '../domain/types.js';

// seenAt backdates a contact discovered by the ChakraHQ history sync. LEAST/GREATEST so an
// old chat sets "pelanggan sejak" correctly without dragging last_seen (and therefore the
// contacts list order) backwards. Live traffic omits it and gets now() for both.
export async function upsertContact(
  waId: string,
  displayName?: string,
  seenAt?: Date
): Promise<Contact> {
  const db = getDb();
  const now = new Date();
  const seen = seenAt ?? now;

  const [row] = await db
    .insert(contacts)
    .values({ waId, displayName: displayName ?? null, firstSeen: seen, lastSeen: seen })
    .onConflictDoUpdate({
      target: contacts.waId,
      set: {
        displayName: displayName ?? undefined,
        firstSeen: sql`LEAST(${contacts.firstSeen}, ${seen.toISOString()}::timestamptz)`,
        lastSeen: sql`GREATEST(${contacts.lastSeen}, ${seen.toISOString()}::timestamptz)`,
      },
    })
    .returning();

  if (!row) throw new Error('Failed to upsert contact');
  return mapContact(row);
}

export async function findContactById(id: string): Promise<Contact | null> {
  const db = getDb();
  const [row] = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
  return row ? mapContact(row) : null;
}

/** null = follow the global default, true/false = pin this contact either way. */
export async function setContactAiEnabled(
  id: string,
  aiEnabled: boolean | null
): Promise<Contact | null> {
  const db = getDb();
  const [row] = await db
    .update(contacts)
    .set({ aiEnabled })
    .where(eq(contacts.id, id))
    .returning();
  return row ? mapContact(row) : null;
}

export async function listContacts(
  params: PaginationParams & {
    search?: string;
    customerType?: CustomerType;
    followUpStatus?: ContactProfileFollowUpStatus;
  }
): Promise<{ items: ContactWithProfile[]; total: number }> {
  const db = getDb();
  const offset = (params.page - 1) * params.limit;

  const conditions = [];
  if (params.search) {
    const pattern = `%${params.search}%`;
    conditions.push(or(ilike(contacts.displayName, pattern), ilike(contacts.waId, pattern)));
  }
  if (params.customerType) conditions.push(eq(contactProfiles.customerType, params.customerType));
  if (params.followUpStatus) conditions.push(eq(contactProfiles.followUpStatus, params.followUpStatus));
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Subquery rather than a join: a contact can own several conversations and a
  // join would duplicate the row (and break the count).
  const conversationIdExpr = sql<string | null>`(
    SELECT id FROM conversations
    WHERE conversations.contact_id = ${contacts.id}
    ORDER BY updated_at DESC
    LIMIT 1
  )`;

  const [rows, countResult] = await Promise.all([
    db
      .select({
        id: contacts.id,
        waId: contacts.waId,
        displayName: contacts.displayName,
        aiEnabled: contacts.aiEnabled,
        firstSeen: contacts.firstSeen,
        lastSeen: contacts.lastSeen,
        customerType: contactProfiles.customerType,
        profile: contactProfiles.profile,
        followUpStatus: contactProfiles.followUpStatus,
        followUpNotes: contactProfiles.followUpNotes,
        conversationId: conversationIdExpr,
      })
      .from(contacts)
      // @ts-ignore drizzle-orm dual-module resolution
      .leftJoin(contactProfiles, eq(contactProfiles.contactId, contacts.id))
      .where(whereClause)
      .orderBy(desc(contacts.lastSeen))
      .limit(params.limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(contacts)
      // @ts-ignore drizzle-orm dual-module resolution
      .leftJoin(contactProfiles, eq(contactProfiles.contactId, contacts.id))
      .where(whereClause),
  ]);

  const items = rows.map((row) => ({
    id: row.id,
    waId: row.waId,
    displayName: row.displayName,
    aiEnabled: row.aiEnabled,
    firstSeen: row.firstSeen,
    lastSeen: row.lastSeen,
    conversationId: row.conversationId,
    customerType: (row.customerType as CustomerType | null) ?? null,
    profile: (row.profile as Record<string, unknown>) ?? {},
    followUpStatus: (row.followUpStatus as ContactProfileFollowUpStatus | null) ?? null,
    followUpNotes: row.followUpNotes ?? null,
  }));

  return { items, total: countResult[0]?.count ?? 0 };
}

function mapContact(row: typeof contacts.$inferSelect): Contact {
  return {
    id: row.id,
    waId: row.waId,
    displayName: row.displayName,
    aiEnabled: row.aiEnabled,
    firstSeen: row.firstSeen,
    lastSeen: row.lastSeen,
  };
}
