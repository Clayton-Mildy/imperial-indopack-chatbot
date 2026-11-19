"use server";

import { auth } from "@/lib/auth";
import {
  getPushPublicKey,
  savePushSubscription,
  removePushSubscription,
  type BrowserPushSubscription,
} from "@/lib/api/push";

/**
 * Server actions, not a browser fetch to the API: API_SECRET_KEY must never reach the browser
 * (see lib/api/client.ts), which is why every other dashboard->API call goes this way too.
 *
 * The staff id comes from the session here rather than from the client, so a subscription can
 * only ever be registered against the logged-in user.
 */

export async function fetchPushPublicKey(): Promise<string> {
  try {
    return await getPushPublicKey();
  } catch {
    return "";
  }
}

export async function subscribeToPush(sub: BrowserPushSubscription): Promise<boolean> {
  const session = await auth();
  const staffId = session?.user?.id;
  if (!staffId) return false;

  try {
    await savePushSubscription(staffId, sub);
    return true;
  } catch {
    return false;
  }
}

export async function unsubscribeFromPush(endpoint: string): Promise<boolean> {
  // No session check: this only ever removes a subscription whose endpoint the caller already
  // holds, and a browser that has revoked notifications must be able to clean up regardless.
  try {
    await removePushSubscription(endpoint);
    return true;
  } catch {
    return false;
  }
}
