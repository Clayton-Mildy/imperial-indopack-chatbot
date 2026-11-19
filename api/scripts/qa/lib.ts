import { readCaptured, type CapturedMessage } from '../../src/services/captureClient.js';

/** A Meta Cloud API webhook body for one customer message. */
export function inboundPayload(m: {
  from: string; id: string; phoneNumberId: string; text?: string;
  image?: { mediaId: string; caption?: string }; referral?: { headline: string }; at?: Date;
}): unknown {
  const timestamp = String(Math.floor((m.at ?? new Date()).getTime() / 1000));
  const message: Record<string, unknown> = { from: m.from, id: m.id, timestamp };
  if (m.image) {
    message['type'] = 'image';
    message['image'] = { id: m.image.mediaId, mime_type: 'image/png', ...(m.image.caption ? { caption: m.image.caption } : {}) };
  } else {
    message['type'] = 'text';
    message['text'] = { body: m.text ?? '' };
  }
  if (m.referral) message['referral'] = { source_type: 'ad', source_id: 'qa-ad-1', headline: m.referral.headline };
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'local-waba',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '620000000070', phone_number_id: m.phoneNumberId },
          contacts: [{ profile: { name: 'Pelanggan Contoh' }, wa_id: m.from }],
          messages: [message],
        },
      }],
    }],
  };
}

export async function postInbound(baseUrl: string, body: unknown): Promise<void> {
  const res = await fetch(`${baseUrl}/webhooks/whatsapp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status !== 200) throw new Error(`webhook answered ${res.status}`);
}

/** A text has arrived and the newest message is at least settleMs old. A document alone never settles
 *  (a price list goes out before the model answers). */
export function settled(msgs: { at: string; kind: string }[], nowMs: number, settleMs: number): boolean {
  if (!msgs.some((m) => m.kind === 'text')) return false;
  const newest = Math.max(...msgs.map((m) => Date.parse(m.at)));
  return nowMs - newest >= settleMs;
}

export async function waitForTurn(o: { logPath: string; to: string; afterId: string | null; settleMs: number; timeoutMs: number }): Promise<CapturedMessage[]> {
  const deadline = Date.now() + o.timeoutMs;
  while (Date.now() < deadline) {
    const msgs = readCaptured(o.logPath, { to: o.to, ...(o.afterId ? { afterId: o.afterId } : {}) });
    if (settled(msgs, Date.now(), o.settleMs)) return msgs;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return [];
}

export const PRICE_RE = /Rp\s?\d{1,3}(\.\d{3})+/;

export interface Check { name: string; ok: boolean; detail?: string }
