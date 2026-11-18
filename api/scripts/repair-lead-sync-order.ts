/**
 * repair-lead-sync-order.ts
 * One-time (re-runnable) repair of leads created in the wrong order by chakraSync, which imports a
 * chat newest message first. Two kinds of damage, found on the 2026-11-10 production copy:
 *
 *   1. Double leads: a plain message sent after the "Request ID" template was imported first and
 *      created an organic lead, then the template its campaign lead - one customer counted as both
 *      Organik and Campaign (6 customers). The untouched organic lead is folded into the campaign
 *      lead, as claimLeadByRequestId now does live (absorbOrganicLead).
 *   2. Late start: the lead was dated by whichever message came in first, not the customer's first
 *      (40 leads, one 88 days late), so it sat in the wrong period of the report. Moved back to the
 *      first customer message, as ensureOrganicLead now does live (backdateFirstContact).
 *
 * Dry run unless --apply. Writes through the same repository functions as the live path.
 * NOT part of update.ps1, like every backfill: it rewrites lead data.
 *
 * Usage:
 *   node dist-scripts/repair-lead-sync-order.js           # dry run
 *   node dist-scripts/repair-lead-sync-order.js --apply
 */

import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { absorbOrganicIntoCampaignLead, ensureOrganicLead } from '../src/repositories/leads.js';

const APPLY = process.argv.includes('--apply');

const iso = (d: unknown) => (d ? new Date(d as string).toISOString().slice(0, 16).replace('T', ' ') : '-');

async function main() {
  const db = getDb();

  // ─── 1. double leads ──────────────────────────────────────────────────────
  // Same "untouched" test as absorbOrganicLead.
  const doubles = await db.execute<{ contact_id: string; wa_id: string; organic_at: string; campaign_at: string }>(sql`
    SELECT o.contact_id, c.wa_id, o.submitted_at AS organic_at, min(k.submitted_at) AS campaign_at
    FROM leads o
    JOIN leads k ON k.contact_id = o.contact_id AND k.request_id IS NOT NULL
    JOIN contacts c ON c.id = o.contact_id
    WHERE o.request_id IS NULL AND o.previous_lead_id IS NULL AND o.status = 'new' AND o.kind = 'lead'
      AND o.human_updated_at IS NULL AND coalesce(o.kind_set_by, '') <> 'staff'
      AND o.deal_value_idr IS NULL AND o.total_orders = 0
      AND NOT EXISTS (SELECT 1 FROM leads r WHERE r.previous_lead_id = o.id)
    GROUP BY o.contact_id, c.wa_id, o.submitted_at
    ORDER BY o.submitted_at
  `);
  console.log(`[double] ${doubles.rows.length} customers with an untouched organic lead beside a campaign lead:`);
  for (const r of doubles.rows) {
    console.log(`  ${r.wa_id}  organic ${iso(r.organic_at)}  campaign ${iso(r.campaign_at)}  -> one campaign lead`);
  }
  let folded = 0;
  if (APPLY) {
    for (const r of doubles.rows) if (await absorbOrganicIntoCampaignLead(r.contact_id)) folded++;
    console.log(`[double] folded ${folded}`);
  }

  // ─── 2. late start ────────────────────────────────────────────────────────
  const late = await db.execute<{ contact_id: string; wa_id: string; campaign: boolean; first_contact_at: string; first_msg: string }>(sql`
    SELECT l.contact_id, c.wa_id, l.request_id IS NOT NULL AS campaign, l.first_contact_at, f.first_msg
    FROM leads l
    JOIN contacts c ON c.id = l.contact_id
    CROSS JOIN LATERAL (
      SELECT min(m.created_at) AS first_msg FROM conversations cv JOIN messages m ON m.conversation_id = cv.id
      WHERE cv.contact_id = l.contact_id AND m.role = 'user'
    ) f
    WHERE l.previous_lead_id IS NULL AND f.first_msg IS NOT NULL AND l.first_contact_at > f.first_msg
    ORDER BY l.first_contact_at - f.first_msg DESC
  `);
  const contacts = [...new Map(late.rows.map((r) => [r.contact_id, r])).values()];
  const gapMs = (r: (typeof late.rows)[number]) => new Date(r.first_contact_at).getTime() - new Date(r.first_msg).getTime();
  const big = late.rows.filter((r) => gapMs(r) >= 60_000);
  // Most gaps are seconds: two messages sent together, handled out of order. Harmless, but moved too.
  console.log(
    `[late] ${late.rows.length} leads start after the customer's first message (${contacts.length} customers): ` +
      `${late.rows.length - big.length} by under a minute, ${big.length} by more:`
  );
  for (const r of big.slice(0, 20)) {
    console.log(`  ${r.wa_id}  ${r.campaign ? 'campaign' : 'organic '}  ${iso(r.first_contact_at)} -> ${iso(r.first_msg)}`);
  }
  if (big.length > 20) console.log(`  ... and ${big.length - 20} more`);
  if (APPLY) {
    // ensureOrganicLead on a contact that already has a lead moves it back to `at` and creates nothing.
    for (const r of contacts) await ensureOrganicLead(r.contact_id, new Date(r.first_msg));
    console.log(`[late] moved back ${contacts.length} customers' leads`);
  }

  console.log(APPLY ? 'Done.' : 'Dry run - nothing written. Re-run with --apply.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
