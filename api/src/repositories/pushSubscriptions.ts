import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { staffPushSubscriptions } from '../db/schema.js';

export interface PushSubscriptionRow {
  id: string;
  staffId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * A browser hands us the same endpoint every time it re-subscribes, and the keys rotate when
 * the browser regenerates them - so this is an upsert on endpoint, never an insert. Without
 * that, one phone accumulates a row per page visit and every escalation is pushed to it N times.
 */
export async function upsertPushSubscription(sub: {
  staffId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}): Promise<void> {
  const db = getDb();
  await db
    .insert(staffPushSubscriptions)
    .values(sub)
    .onConflictDoUpdate({
      target: staffPushSubscriptions.endpoint,
      set: { staffId: sub.staffId, p256dh: sub.p256dh, auth: sub.auth },
    });
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  const db = getDb();
  await db.delete(staffPushSubscriptions).where(eq(staffPushSubscriptions.endpoint, endpoint));
}

export async function listPushSubscriptions(): Promise<PushSubscriptionRow[]> {
  const db = getDb();
  return db
    .select({
      id: staffPushSubscriptions.id,
      staffId: staffPushSubscriptions.staffId,
      endpoint: staffPushSubscriptions.endpoint,
      p256dh: staffPushSubscriptions.p256dh,
      auth: staffPushSubscriptions.auth,
    })
    .from(staffPushSubscriptions);
}
