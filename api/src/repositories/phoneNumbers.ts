import { count, eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { conversations, phoneNumbers } from '../db/schema.js';
import type { PhoneNumber, PromptSections } from '../domain/types.js';

export async function listPhoneNumbers(): Promise<PhoneNumber[]> {
  const db = getDb();
  const rows = await db.select().from(phoneNumbers).orderBy(phoneNumbers.createdAt);
  return rows.map(mapPhoneNumber);
}

export async function findPhoneNumberById(id: string): Promise<PhoneNumber | null> {
  const db = getDb();
  const [row] = await db.select().from(phoneNumbers).where(eq(phoneNumbers.id, id)).limit(1);
  return row ? mapPhoneNumber(row) : null;
}


// Chakra's chat.providerHandleId IS Meta's phone number id, i.e. phone_numbers.phone_number_id.
export async function findPhoneNumberByProviderId(providerId: string): Promise<PhoneNumber | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(phoneNumbers)
    .where(eq(phoneNumbers.phoneNumberId, providerId))
    .limit(1);
  return row ? mapPhoneNumber(row) : null;
}

export async function getFirstPhoneNumber(): Promise<PhoneNumber | null> {
  const db = getDb();
  // Deterministic pick (createdAt, then id) so duplicate rows can't scatter live
  // traffic across phone numbers — matches listPhoneNumbers ordering.
  const [row] = await db
    .select()
    .from(phoneNumbers)
    .orderBy(phoneNumbers.createdAt, phoneNumbers.id)
    .limit(1);
  return row ? mapPhoneNumber(row) : null;
}

export async function createPhoneNumber(data: {
  number: string;
  label?: string;
  wabaId: string;
  phoneNumberId: string;
}): Promise<PhoneNumber> {
  const db = getDb();
  const [row] = await db.insert(phoneNumbers).values(data).returning();
  if (!row) throw new Error('Failed to create phone number');
  return mapPhoneNumber(row);
}

export async function updatePhoneNumber(
  id: string,
  data: { label?: string; metaAccessToken?: string | null; customSystemPrompt?: string | null; promptSections?: PromptSections | null }
): Promise<PhoneNumber | null> {
  const db = getDb();
  const [row] = await db
    .update(phoneNumbers)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(phoneNumbers.id, id))
    .returning();
  return row ? mapPhoneNumber(row) : null;
}

/** How many conversations run on this number: a number with any cannot be deleted (conversations reference it). */
export async function countConversationsForPhoneNumber(id: string): Promise<number> {
  const [row] = await getDb().select({ n: count() }).from(conversations).where(eq(conversations.phoneNumberId, id));
  return Number(row?.n ?? 0);
}

export async function deletePhoneNumber(id: string): Promise<boolean> {
  const db = getDb();
  const result = await db.delete(phoneNumbers).where(eq(phoneNumbers.id, id)).returning();
  return result.length > 0;
}

function mapPhoneNumber(row: typeof phoneNumbers.$inferSelect): PhoneNumber {
  return {
    id: row.id,
    number: row.number,
    label: row.label,
    wabaId: row.wabaId,
    phoneNumberId: row.phoneNumberId,
    metaAccessToken: row.metaAccessToken ?? null,
    customSystemPrompt: row.customSystemPrompt ?? null,
    promptSections: row.promptSections as PromptSections | null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
