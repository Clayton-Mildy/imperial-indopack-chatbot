/**
 * Posts one customer message to a local API and prints the captured replies.
 * Usage: tsx scripts/qa/say.ts [--base <url>] [--log <path>] <phone> <text>
 * Defaults: http://localhost:50070 and logs/whatsapp-capture.jsonl; phone number id local-phone-70.
 */
import { randomUUID } from 'crypto';
import { readCaptured } from '../../src/services/captureClient.js';
import { inboundPayload, postInbound, waitForTurn } from './lib.js';

const args = process.argv.slice(2);
const take = (flag: string, fallback: string): string => {
  const i = args.indexOf(flag);
  if (i < 0) return fallback;
  const v = args[i + 1] ?? fallback;
  args.splice(i, 2);
  return v;
};
const base = take('--base', 'http://localhost:50070');
const log = take('--log', 'logs/whatsapp-capture.jsonl');
const [phone, ...rest] = args;
const text = rest.join(' ');
if (!phone || !text) {
  console.error('usage: say.ts [--base <url>] [--log <path>] <phone> <text>');
  process.exit(1);
}

const before = readCaptured(log, { to: phone });
const afterId = before.length ? before[before.length - 1]!.id : null;
await postInbound(base, inboundPayload({ from: phone, id: `wamid.say-${randomUUID()}`, phoneNumberId: 'local-phone-70', text }));
const replies = await waitForTurn({ logPath: log, to: phone, afterId, settleMs: 8000, timeoutMs: 240_000 });
if (replies.length === 0) console.log('(no reply)');
for (const m of replies) {
  if (m.kind === 'text') console.log(`Bot: ${m.text}`);
  else if (m.kind === 'document') console.log(`[dokumen] ${m.filename ?? m.path}`);
  else console.log(`[foto] ${m.path}`);
}
