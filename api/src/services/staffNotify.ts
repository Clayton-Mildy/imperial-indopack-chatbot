import webpush from 'web-push';
import { getConfig } from '../config.js';
import { listPushSubscriptions, deletePushSubscription } from '../repositories/pushSubscriptions.js';
import { getFirstPhoneNumber } from '../repositories/phoneNumbers.js';
import { sendTextMessage } from './whatsappSender.js';

/**
 * The one way this system reaches a human.
 *
 * Before this existed, "escalation" notified nobody: escalateConversation's third argument is
 * the CUSTOMER's WhatsApp id, so the hand-off message went back to the person who was already
 * waiting, and the only staff-facing surface was an escalations queue polled by an open browser
 * tab. Live, a 3-carton order sat escalated across two days while the bot repeated
 * the same holding line and nobody knew.
 *
 * Two channels, because neither covers everyone on its own: web push needs a subscription
 * (iOS wants 16.4+ AND the site added to the Home Screen), while WhatsApp reaches any phone but
 * costs a message. Both are opt-in via env and inert when unset, so a deploy that configures
 * neither behaves exactly as it does today.
 *
 * Never throws: notification is a side effect of a customer-facing turn, and a dead push
 * service must not take the reply down with it.
 */

let vapidReady: boolean | null = null;

function ensureVapid(): boolean {
  if (vapidReady !== null) return vapidReady;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = getConfig();
  vapidReady = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
  if (vapidReady) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  } else {
    console.warn('[staffNotify] VAPID keys not set - web push disabled');
  }
  return vapidReady;
}

// Exposed for tests: the cached VAPID check would otherwise survive an env change.
export function resetVapidCache(): void {
  vapidReady = null;
}

export interface StaffNotification {
  title: string;
  body: string;
  /** Path on the dashboard, e.g. `/conversations/<id>`. Opened when the notification is tapped. */
  path?: string;
}

/**
 * The dashboard is served under /app on the same public origin as this API (see the
 * @fastify/http-proxy registration in app.ts), so PUBLIC_BASE_URL is all we need to build a
 * tappable link - there is no second hostname to keep in sync.
 */
function dashboardUrl(path?: string): string {
  const base = getConfig().PUBLIC_BASE_URL.replace(/\/$/, '');
  return `${base}/app${path ?? ''}`;
}

async function pushToAll(n: StaffNotification): Promise<void> {
  if (!ensureVapid()) return;
  const subs = await listPushSubscriptions();
  if (subs.length === 0) return;

  const payload = JSON.stringify({ title: n.title, body: n.body, url: dashboardUrl(n.path) });
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
      } catch (err) {
        // 404/410 is the push service saying this subscription is gone for good - the browser
        // was uninstalled, notifications were revoked, or the endpoint rotated. Keeping it
        // means retrying a dead address on every escalation forever.
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await deletePushSubscription(sub.endpoint).catch(() => { });
          return;
        }
        console.warn('[staffNotify] push failed:', err instanceof Error ? err.message : err);
      }
    })
  );
}

async function whatsappPing(n: StaffNotification): Promise<void> {
  const to = getConfig().ESCALATION_NOTIFY_WA;
  if (!to) return;
  const phoneNumber = await getFirstPhoneNumber();
  if (!phoneNumber) return;
  await sendTextMessage(phoneNumber.phoneNumberId, to, `${n.title}\n${n.body}\n${dashboardUrl(n.path)}`);
}

/** Fire-and-forget. Callers are on a customer's reply path and must not wait on this. */
export function notifyStaff(n: StaffNotification): void {
  void Promise.allSettled([pushToAll(n), whatsappPing(n)]).then((results) => {
    for (const r of results) {
      if (r.status === 'rejected') {
        console.warn('[staffNotify] channel failed:', r.reason instanceof Error ? r.reason.message : r.reason);
      }
    }
  });
}
