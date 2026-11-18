/**
 * backfill-leads.ts
 * One-time (re-runnable) backfill: builds the `leads` table from the message history that
 * already exists, so the campaign report has a past on the day it ships instead of starting
 * empty.
 *
 * Two passes, deliberately in this order:
 *   1. Every inbound message carrying "Request ID: <uuid>" claims its campaign lead, dated
 *      to the message itself. Oldest first, so claim-once keeps the earliest contact.
 *   2. Every contact still without any lead gets one organic lead, dated to their first
 *      message. Running this second is what stops a contact who arrived through an ad from
 *      also being counted as organic.
 *
 * Idempotent: pass 1 upserts on request_id, pass 2 is a NOT EXISTS insert. Safe to re-run.
 *
 * NOT part of update.ps1 — same rule as the seeds: a routine deploy must never be able to
 * rewrite lead data.
 *
 * Usage:
 *   npx tsx scripts/backfill-leads.ts              # live run
 *   npx tsx scripts/backfill-leads.ts --dry-run    # print only, no writes
 */

import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { extractRequestId, extractFormFields } from '../src/services/leadMatcher.js';
import { claimLeadByRequestId } from '../src/repositories/leads.js';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const db = getDb();

  // ─── pass 1: campaign leads from the template messages ───────────────────
  // The ILIKE is only a cheap prefilter; extractRequestId is the real test.
  const candidates = await db.execute<{
    contact_id: string;
    body: string;
    created_at: Date;
  }>(sql`
    SELECT c.id AS contact_id, m.body, m.created_at
    FROM messages m
    JOIN conversations cv ON cv.id = m.conversation_id
    JOIN contacts c ON c.id = cv.contact_id
    WHERE m.role = 'user' AND m.body ILIKE '%request%id%'
    ORDER BY m.created_at ASC
  `);

  let matched = 0;
  let noId = 0;
  for (const row of candidates.rows) {
    const requestId = extractRequestId(row.body);
    if (!requestId) {
      noId++;
      continue;
    }
    if (!DRY_RUN) {
      await claimLeadByRequestId(
        requestId,
        row.contact_id,
        extractFormFields(row.body),
        new Date(row.created_at)
      );
    }
    matched++;
    console.log(`  campaign lead ${requestId} -> contact ${row.contact_id}`);
  }

  // ─── pass 2: one organic lead per remaining contact ──────────────────────
  // Single statement rather than a loop: it is the same NOT EXISTS guard the live path
  // uses, applied to every contact at once, and it dates each row to that contact's real
  // first message so the report's date buckets are truthful.
  const organicSql = sql`
    INSERT INTO leads (contact_id, submitted_at, matched_at)
    SELECT c.id, min(m.created_at), min(m.created_at)
    FROM contacts c
    JOIN conversations cv ON cv.contact_id = c.id
    JOIN messages m ON m.conversation_id = cv.id
    WHERE NOT EXISTS (SELECT 1 FROM leads l WHERE l.contact_id = c.id)
    GROUP BY c.id
    ON CONFLICT DO NOTHING
  `;

  let organic = 0;
  if (DRY_RUN) {
    const preview = await db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count
      FROM (
        SELECT c.id
        FROM contacts c
        JOIN conversations cv ON cv.contact_id = c.id
        JOIN messages m ON m.conversation_id = cv.id
        WHERE NOT EXISTS (SELECT 1 FROM leads l WHERE l.contact_id = c.id)
        GROUP BY c.id
      ) t
    `);
    organic = preview.rows[0]?.count ?? 0;
  } else {
    const inserted = await db.execute(organicSql);
    organic = inserted.rowCount ?? 0;
  }

  console.log('');
  console.log(`${DRY_RUN ? '[dry run] ' : ''}Backfill complete:`);
  console.log(`  campaign leads matched : ${matched}`);
  console.log(`  organic leads created  : ${organic}`);
  console.log(`  messages mentioning "request id" but carrying no valid uuid: ${noId}`);
  console.log('');
  console.log('Reminder: UTM data is not in the chat history. Import marketing\'s Excel');
  console.log('export on /leads to attach campaigns to the matched leads.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
