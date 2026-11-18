/**
 * Sends a test notification to every registered staff device, and says which link is broken
 * when nothing arrives.
 *
 * Push has four places to fail silently - no VAPID keys, invalid keys, nobody subscribed, or a
 * dead subscription - and from the outside all four look identical: the phone stays quiet. This
 * walks them in order so an operator does not have to guess, or trigger a real escalation and
 * wait ~40s to learn nothing.
 *
 * Run from the API root:  node dist-scripts/push-test.js
 */
import 'dotenv/config';
import webpush from 'web-push';
import { getDb } from '../src/db/client.js';
import { staffPushSubscriptions } from '../src/db/schema.js';

const { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: subj } = process.env;

console.log('1. VAPID keys in .env :', pub && priv ? `yes (public ${pub.length} chars)` : 'NO - web push is disabled');
console.log('   VAPID_SUBJECT      :', subj ?? '(unset, uses the code default)');
if (!pub || !priv) {
  console.log('\n-> Add the keys to .env and restart imperial-indopack-api. Nothing downstream can work until then.');
  console.log('   Generate a pair:  node -e "const w=require(\'web-push\'),k=w.generateVAPIDKeys();console.log(k)"');
  process.exit(1);
}

try {
  webpush.setVapidDetails(subj ?? 'mailto:you@example.com', pub, priv);
  console.log('2. Keys are valid     : yes');
} catch (err) {
  console.log('2. Keys are INVALID   :', err instanceof Error ? err.message : err);
  process.exit(1);
}

const subs = await getDb().select().from(staffPushSubscriptions);
console.log('3. Subscriptions      :', subs.length);
if (subs.length === 0) {
  console.log('\n-> Nobody has pressed "Aktifkan notifikasi" yet, or the subscribe call failed.');
  console.log('   On iOS the site must be added to the Home Screen first - a Safari tab cannot subscribe.');
  process.exit(1);
}

const url = `${(process.env['PUBLIC_BASE_URL'] ?? '').replace(/\/$/, '')}/app/escalations`;
const payload = JSON.stringify({
  title: 'Tes notifikasi',
  body: 'Kalau ini muncul di HP, push sudah jalan.',
  url,
});

for (const sub of subs) {
  const host = new URL(sub.endpoint).host;
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload
    );
    console.log(`4. SENT   -> ${host}  (check the phone)`);
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    const body = String((err as { body?: string }).body ?? (err as Error).message).trim();
    console.log(`4. FAILED -> ${host}  status=${status} ${body.slice(0, 60)}`);
    // Exactly what staffNotify prunes on, so a repeat run should show one row fewer.
    if (status === 404 || status === 410) {
      console.log('             dead subscription - re-enable notifications on that device');
    }
  }
}
process.exit(0);
