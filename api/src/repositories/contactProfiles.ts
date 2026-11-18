import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { contactProfiles } from '../db/schema.js';
import type { ContactProfile, ContactProfileFollowUpStatus, CustomerType } from '../domain/types.js';

export async function upsertContactProfile(
  contactId: string,
  updates: {
    customerType?: CustomerType;
    profilePatch?: Record<string, unknown>;
    followUpStatus?: ContactProfileFollowUpStatus;
    followUpNotes?: string;
  }
): Promise<ContactProfile> {
  const db = getDb();
  const now = new Date();

  // Single round trip: ON CONFLICT merges into the existing row (jsonb || is the same
  // top-level merge the old read-then-write spread did). Runs right before the
  // escalation hand-off message, so the extra SELECT was on the customer's clock.
  const [row] = await db
    .insert(contactProfiles)
    .values({
      contactId,
      customerType: updates.customerType ?? null,
      profile: updates.profilePatch ?? {},
      followUpStatus: updates.followUpStatus ?? 'none',
      followUpNotes: updates.followUpNotes ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: contactProfiles.contactId,
      set: {
        customerType: updates.customerType !== undefined
          ? updates.customerType
          : sql`${contactProfiles.customerType}`,
        profile: updates.profilePatch
          ? sql`coalesce(${contactProfiles.profile}, '{}'::jsonb) || ${JSON.stringify(updates.profilePatch)}::jsonb`
          : sql`${contactProfiles.profile}`,
        followUpStatus: updates.followUpStatus ?? sql`${contactProfiles.followUpStatus}`,
        followUpNotes: updates.followUpNotes !== undefined
          ? updates.followUpNotes
          : sql`${contactProfiles.followUpNotes}`,
        updatedAt: now,
      },
    })
    .returning();

  if (!row) throw new Error('Failed to upsert contact profile');
  return mapProfile(row);
}

export async function getContactProfile(contactId: string): Promise<ContactProfile | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(contactProfiles)
    .where(eq(contactProfiles.contactId, contactId))
    .limit(1);
  return row ? mapProfile(row) : null;
}

// Deleted, not blanked: the row holds only what the model wrote (CATAT), upsertContactProfile
// recreates it on the next turn, and getContactProfile returning null is what makes
// pickProfileGapQuestion ask buyer type again. listLeads/listContacts already leftJoin it.
export async function deleteContactProfile(contactId: string): Promise<void> {
  const db = getDb();
  await db.delete(contactProfiles).where(eq(contactProfiles.contactId, contactId));
}

export async function markFollowUpDone(contactId: string): Promise<void> {
  const db = getDb();
  await db
    .update(contactProfiles)
    .set({ followUpStatus: 'done', updatedAt: new Date() })
    .where(eq(contactProfiles.contactId, contactId));
}

function mapProfile(row: typeof contactProfiles.$inferSelect): ContactProfile {
  return {
    id: row.id,
    contactId: row.contactId,
    customerType: (row.customerType as ContactProfile['customerType']) ?? null,
    profile: (row.profile as Record<string, unknown>) ?? {},
    followUpStatus: row.followUpStatus as ContactProfileFollowUpStatus,
    followUpNotes: row.followUpNotes ?? null,
    updatedAt: row.updatedAt,
  };
}

/**
 * Fill what the profile does not know yet, and nothing else. Used by the background lead-insights
 * pass, which reads a chat after the fact: whatever the live bot (or a later turn) already wrote is
 * the better-informed value, and customer_type decides which price the bot may quote, so a second
 * opinion must never flip it.
 */
export async function fillContactProfileGaps(
  contactId: string,
  fill: { customerType?: CustomerType; facts: Record<string, unknown> }
): Promise<void> {
  const db = getDb();
  const facts = JSON.stringify(fill.facts);
  await db
    .insert(contactProfiles)
    .values({ contactId, customerType: fill.customerType ?? null, profile: fill.facts, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: contactProfiles.contactId,
      set: {
        customerType: sql`coalesce(${contactProfiles.customerType}, ${fill.customerType ?? null})`,
        // jsonb || lets the right side win, so the existing profile goes on the right. Its empty
        // values are stripped first, or a key the model once wrote as "" would block the fill.
        profile: sql`${facts}::jsonb || (
          jsonb_strip_nulls(coalesce(${contactProfiles.profile}, '{}'::jsonb)) - coalesce((
            SELECT array_agg(key) FROM jsonb_each_text(coalesce(${contactProfiles.profile}, '{}'::jsonb)) WHERE value = ''
          ), '{}'::text[])
        )`,
        updatedAt: new Date(),
      },
    });
}
