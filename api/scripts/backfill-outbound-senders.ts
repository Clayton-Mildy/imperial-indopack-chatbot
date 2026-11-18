/**
 * backfill-outbound-senders.ts
 * One-time (re-runnable) repair of who-sent-it labels on messages chakraSync imported before
 * today's rules existed. The sync never revisits a row it already has, so without this those
 * chats keep showing staff replies as "AI" - and feeding them to the model as the bot's words.
 *
 *   1. Texts (SQL only, needs --since). An outbound text the sync imported was typed by a person -
 *      the rule chakraSync has applied since 2026-10-08 - but rows imported before then were stored
 *      with no sender. That rule only holds while the bot stores every reply it sends in THIS
 *      database: in early September it ran from a Mac, its rows never reached production, and the
 *      sync's copies of its replies ("Halo Kak Dilla! 😊 ...") have no bot twin to tell them apart.
 *      So texts are relabelled only from --since (the day the bot started running on the PC), and
 *      the dry run lists bot-looking rows in that range to check by eye first.
 *      Skipped: the staff-notify chat (the bot's own pings) and any row with a bot twin (same text
 *      from a non-sync row within 10 min: a bot reply stored without its wamid).
 *   2. Photos and documents (--files, walks every Chakra chat). Label by chakraSync's own rule -
 *      sent by link = the bot, otherwise a person - and attach the file: the link it was sent by,
 *      or (with --apply) a fresh download through Chakra / Meta.
 *
 * Dry run unless --apply: prints counts and samples and writes nothing. Idempotent.
 * NOT part of update.ps1, like every backfill: it rewrites message history.
 *
 * Usage:
 *   node dist-scripts/backfill-outbound-senders.js --since=2026-09-25                  # texts, dry run
 *   node dist-scripts/backfill-outbound-senders.js --since=2026-09-25 --files          # + files, dry run
 *   node dist-scripts/backfill-outbound-senders.js --since=2026-09-25 --files --apply  # write
 */

import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { getConfig } from '../src/config.js';
import { repairOutboundFiles } from '../src/services/chakraSync.js';

const APPLY = process.argv.includes('--apply');
const FILES = process.argv.includes('--files');
const PHONE_REPLY_SENDER = 'Tim CS'; // chakraSync's label
const SINCE = process.argv.find((a) => a.startsWith('--since='))?.slice('--since='.length) ?? '';
// What the bot writes and staff rarely do: a dash, Markdown bold, its canned lines.
const BOT_LOOKING = String.raw`(—|\*\*|dijual kembali atau dipakai sendiri|ada yang bisa saya bantu|cek dengan tim dulu)`;

async function main() {
  const db = getDb();
  const notifyWa = (getConfig().ESCALATION_NOTIFY_WA ?? '').replace(/\D/g, '');

  // ─── 1. texts ─────────────────────────────────────────────────────────────
  if (!/^\d{4}-\d{2}-\d{2}$/.test(SINCE)) {
    console.log('[texts] not run - pass --since=YYYY-MM-DD, the day the bot started running on the PC (see the header)');
  } else {
    await relabelTexts(db, notifyWa);
  }

  // ─── 2. photos and documents ──────────────────────────────────────────────
  await repairFiles();

  console.log(APPLY ? 'Done.' : 'Dry run - nothing written. Re-run with --apply.');
  process.exit(0);
}

async function relabelTexts(db: ReturnType<typeof getDb>, notifyWa: string) {
  // WIB midnight.
  const since = `${SINCE}T00:00:00+07:00`;
  const candidates = sql`
    SELECT m.id, m.body, m.created_at
    FROM messages m
    JOIN conversations cv ON cv.id = m.conversation_id
    JOIN contacts c ON c.id = cv.contact_id
    WHERE m.role = 'assistant'
      AND m.sender_name IS NULL
      AND m.metadata->>'source' = 'chakra_sync'
      AND m.created_at >= ${since}::timestamptz
      AND m.metadata->>'attachmentType' IS NULL
      AND coalesce(m.metadata->>'dataType', 'text') = 'text'
      AND (${notifyWa} = '' OR c.wa_id <> ${notifyWa})
      AND NOT EXISTS (
        SELECT 1 FROM messages b
        WHERE b.conversation_id = m.conversation_id
          AND b.role = 'assistant'
          AND b.id <> m.id
          AND coalesce(b.metadata->>'source', '') <> 'chakra_sync'
          AND b.body = m.body
          AND b.created_at BETWEEN m.created_at - interval '10 minutes' AND m.created_at + interval '10 minutes'
      )
  `;
  const byMonth = await db.execute<{ month: string; n: number }>(sql`
    SELECT to_char(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') AS month, count(*)::int AS n
    FROM (${candidates}) x GROUP BY 1 ORDER BY 1
  `);
  const total = byMonth.rows.reduce((sum, r) => sum + r.n, 0);
  console.log(`[texts] ${total} staff texts stored without a sender:`);
  for (const r of byMonth.rows) console.log(`  ${r.month}  ${r.n}`);
  const samples = await db.execute<{ created_at: Date; body: string }>(sql`
    SELECT created_at, body FROM (${candidates}) x ORDER BY created_at DESC LIMIT 10
  `);
  for (const s of samples.rows) {
    console.log(`  e.g. ${new Date(s.created_at).toISOString().slice(0, 16)}  ${s.body.replace(/\s+/g, ' ').slice(0, 80)}`);
  }
  const suspects = await db.execute<{ created_at: Date; body: string }>(sql`
    SELECT created_at, body FROM (${candidates}) x WHERE body ~* ${BOT_LOOKING} ORDER BY created_at DESC LIMIT 15
  `);
  console.log(`[texts] ${suspects.rows.length === 15 ? '15+' : suspects.rows.length} of them look like the bot's writing - check these are staff before --apply:`);
  for (const s of suspects.rows) {
    console.log(`  ?? ${new Date(s.created_at).toISOString().slice(0, 16)}  ${s.body.replace(/\s+/g, ' ').slice(0, 80)}`);
  }
  if (APPLY && total > 0) {
    const res = await db.execute(sql`
      UPDATE messages SET sender_name = ${PHONE_REPLY_SENDER}
      WHERE id IN (SELECT id FROM (${candidates}) x)
    `);
    console.log(`[texts] labelled ${res.rowCount ?? 0} as "${PHONE_REPLY_SENDER}"`);
  }
}

async function repairFiles() {
  if (FILES) {
    if (getConfig().WHATSAPP_TRANSPORT !== 'chakra' || !getConfig().CHAKRA_ACCESS_TOKEN) {
      console.log('[files] skipped: needs the Chakra transport and CHAKRA_ACCESS_TOKEN');
    } else {
      console.log('[files] walking every Chakra chat...');
      const r = await repairOutboundFiles({ apply: APPLY });
      console.log(
        `[files] ${r.chats} chats, ${r.files} synced outbound files: ${r.relabelled} relabelled, ` +
          `${r.fileFound} with a file to show, ${r.fileMissing} still without one`
      );
      for (const s of r.samples) console.log(`  e.g. ${s}`);
      if (!r.labelsWritten && r.files > 0) {
        console.log(
          '  WARNING: no file was sent by link, so Chakra does not keep the link and the bot\'s files cannot be ' +
            'told from staff\'s. Labels are left alone; --apply only attaches files.'
        );
      }
      if (!APPLY && r.fileMissing > 0) {
        console.log('  (a dry run downloads nothing - "still without one" includes files --apply may fetch)');
      }
    }
  } else {
    console.log('[files] not run - add --files to repair photos and documents too');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
