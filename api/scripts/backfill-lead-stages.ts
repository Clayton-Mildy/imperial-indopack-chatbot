/**
 * backfill-lead-stages.ts
 * Replays the background lead pass (services/leadInsights.ts) over past chats, so the lead report
 * has kind / stage / lost-reason history on the day it ships.
 *
 * Hand-run on the production PC after a deploy. NOT part of update.ps1: it spends model quota and
 * writes lead data, and a routine deploy must never be able to do either.
 *
 * Default is a DRY RUN that writes nothing: it reads up to 200 chats (newest first), asks the model,
 * and prints what each answer WOULD change. --apply writes, in batches of 25, and needs --since.
 * The writes are the live pass's own (same checks, same locks): a won/lost still needs evidence that
 * is a customer message, a Won lead never moves, and leads staff touched (human_updated_at, or a kind
 * staff set) are skipped before the model is even called. Stops at the first model error; re-run it.
 *
 * Usage:
 *   npx tsx scripts/backfill-lead-stages.ts                          # dry run, 200 chats
 *   npx tsx scripts/backfill-lead-stages.ts --since=2026-11-04       # dry run, chats read before that day
 *   npx tsx scripts/backfill-lead-stages.ts --apply --since=2026-11-04
 *     --since = the deploy date: every chat whose watermark is empty or older is read once more.
 *     A chat is stamped with --since afterwards, so a re-run only picks up what is left.
 *   Add --limit=N to cap a dry run (default 200).
 */

import 'dotenv/config';
import { runLeadInsightsPass } from '../src/services/leadInsights.js';
import { closeSilentLeads } from '../src/repositories/leads.js';
import { getLeadSilenceLostDays } from '../src/repositories/appSettings.js';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const APPLY = args.includes('--apply');
const SINCE_RAW = flag('since');
const LIMIT = Number(flag('limit') ?? 200);
const BATCH = 25;
const MAX_EVIDENCE_SAMPLES = 20;

const ascii = (s: string) => s.replace(/[^\x20-\x7E]/g, '?');
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
const printMap = (title: string, m: Map<string, number>) => {
  console.log(`${title}:`);
  if (m.size === 0) console.log('  (none)');
  for (const [k, v] of [...m.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);
};

async function main() {
  let since: Date | undefined;
  if (SINCE_RAW !== undefined) {
    since = /^\d{4}-\d{2}-\d{2}$/.test(SINCE_RAW) ? new Date(`${SINCE_RAW}T00:00:00+07:00`) : undefined;
    if (!since || Number.isNaN(since.getTime())) {
      console.error('--since must be YYYY-MM-DD (a WIB date).');
      process.exit(1);
    }
    if (since.getTime() > Date.now()) {
      console.error(`--since=${SINCE_RAW} is in the future. Chats would be marked as read until then and the live lead pass would skip them. Use the deploy date or earlier.`);
      process.exit(1);
    }
  }
  if (APPLY && !since) {
    console.error('--apply needs --since=YYYY-MM-DD (the deploy date): without it there is no way to tell which chats were already read.');
    process.exit(1);
  }
  if (!APPLY && (!Number.isInteger(LIMIT) || LIMIT < 1)) {
    console.error('--limit must be a positive number.');
    process.exit(1);
  }

  const kinds = new Map<string, number>();
  const changes = new Map<string, number>();
  const lostReasons = new Map<string, number>();
  const samples: string[] = [];
  const orderSamples: string[] = [];
  let orders = 0;
  let read = 0;
  let skippedStaff = 0;
  let errors = 0;
  let unreadable = 0;

  const opts = {
    dryRun: !APPLY,
    ignoreWatermark: true,
    since,
    skipStaff: true,
    // A chat is read once here, so read its history: a repeat buyer had 9 orders since June, 7 of them
    // before the last 40 messages the live pass reads (it reads every new burst, so it needs no more).
    transcriptMessages: 200,
    onResult: (r: { conversationId: string; insights: { lead_kind: string | null; lost_reason: string | null }; wouldChange: string[] }) => {
      read++;
      bump(kinds, r.insights.lead_kind ?? '(none)');
      for (const line of r.wouldChange) {
        const m = /^status (\w+)->(\w+)/.exec(line);
        if (m) {
          bump(changes, `${m[1]} -> ${m[2]}`);
          if (m[2] === 'lost') bump(lostReasons, r.insights.lost_reason ?? '(no reason)');
        }
        if (line.includes('evidence:') && samples.length < MAX_EVIDENCE_SAMPLES) samples.push(`[evidence] ${r.conversationId.slice(0, 8)} ${ascii(line)}`);
        if (line.startsWith('order ')) {
          orders++;
          if (orderSamples.length < MAX_EVIDENCE_SAMPLES) orderSamples.push(`[order] ${r.conversationId.slice(0, 8)} ${ascii(line.slice(6))}`);
        }
      }
    },
    onSkip: (s: { reason: 'staff' | 'unreadable' }) => {
      if (s.reason === 'staff') skippedStaff++;
      else unreadable++;
    },
    onError: () => { errors++; },
  };

  console.log(APPLY ? `APPLY: batches of ${BATCH}, chats with no read since ${SINCE_RAW}.` : `DRY RUN: nothing is written. Up to ${LIMIT} chats.`);
  if (APPLY) {
    // Each batch stamps what it read, so the next one selects the rest; a model error ends the run.
    for (;;) {
      const errorsBefore = errors;
      const n = await runLeadInsightsPass(BATCH, opts);
      console.log(`  batch: ${n} chat(s) (read ${read}, skipped staff ${skippedStaff}, errors ${errors})`);
      if (n === 0 || errors > errorsBefore) break;
    }
  } else {
    await runLeadInsightsPass(LIMIT, opts);
  }

  console.log('');
  console.log(`${APPLY ? 'Applied' : 'Dry run'} - chats read: ${read}`);
  printMap('Kind', kinds);
  printMap(APPLY ? 'Status changes' : 'Status changes (would)', changes);
  printMap('Lost reasons', lostReasons);
  // Counted per read, before the lead_orders dedup: an order already on record shows here again.
  console.log(`orders found: ${orders}`);
  console.log(`skipped (staff): ${skippedStaff}`);
  console.log(`errors: ${errors}${errors ? ' (model call failed; re-run to continue)' : ''}`);
  console.log(`unreadable answers: ${unreadable}`);
  if (samples.length || orderSamples.length) {
    console.log('');
    for (const s of [...samples, ...orderSamples]) console.log(s);
  }
  // Not written here even with --apply: the live sweep closes them every 10 minutes, dated when the
  // threshold passed. Counted so the first deploy's jump in Lost is expected, not a surprise.
  const silenceDays = await getLeadSilenceLostDays();
  const silent = await closeSilentLeads(silenceDays, { dryRun: true });
  console.log(`\nno customer reply for ${silenceDays}+ days (the live sweep closes these as Lost, tidak_ada_respon): ${silent.length}`);
  if (!APPLY) console.log('\nNothing was written. Re-run with --apply --since=YYYY-MM-DD to write.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
