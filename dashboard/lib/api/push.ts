import { apiFetch } from "./client";

export interface BrowserPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * Served by the API rather than baked into this build as NEXT_PUBLIC_*, so the VAPID keypair
 * lives in exactly one place. A second copy here would silently drift on rotation and break
 * every new subscription with no error anyone would see. Empty string means push is not
 * configured on the API - the UI hides the toggle rather than offering something that cannot work.
 */
export async function getPushPublicKey(): Promise<string> {
  const envelope = await apiFetch<{ publicKey: string }>("/push/public-key");
  return envelope.data?.publicKey ?? "";
}

export async function savePushSubscription(
  staffId: string,
  sub: BrowserPushSubscription
): Promise<void> {
  await apiFetch("/push/subscribe", {
    method: "POST",
    body: JSON.stringify({ staffId, endpoint: sub.endpoint, keys: sub.keys }),
  });
}

export async function removePushSubscription(endpoint: string): Promise<void> {
  await apiFetch("/push/subscribe", {
    method: "DELETE",
    body: JSON.stringify({ endpoint }),
  });
}
