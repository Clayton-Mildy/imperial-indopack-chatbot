import { sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { IS_CURRENT_LEAD_SQL, WAITING_SINCE_SQL, isRecentWaitSql, wibDayStart } from './leads.js';
import { LEAD_STATUSES } from '../domain/types.js';
import type { LeadReport, LeadStatus, LostReason } from '../domain/types.js';

/**
 * The numbers on the "Ringkasan" page. Every block is `kind = 'lead'` only, and every day is a
 * WIB day: range bounds come from `wibDayStart` (never the UTC-midnight idiom in activityLogs.ts)
 * and per-day buckets use `AT TIME ZONE 'Asia/Jakarta'` (fixed +07:00, no DST).
 *
 * One SQL per block. Definitions (spec section 3):
 *  - newLeads / returningLeads: submitted_at in range (returning: previous_lead_id set).
 *  - contactedLeads: distinct contacts of kind='lead' leads with >=1 role='user' message in
 *    range. A contact with several leads counts once - attributing a message to one specific
 *    lead of the contact would need a rule for "which lead", and the page only needs "how many
 *    people wrote to us".
 *  - won / lost: closed_at in range with that status.
 *  - conversionPct: of the range's new leads, the share now `won` (it can rise later).
 *  - avgDaysToClose: mean of closed_at - coalesce(first_contact_at, matched_at, submitted_at)
 *    over leads won in range (campaign leads that were imported and then claimed have no
 *    first_contact_at).
 *  - funnel: current status of the range's new leads. lostReasons: leads lost in range.
 *  - unreplied: live, range ignored, newest message is the customer's and at most
 *    UNREPLIED_MAX_AGE_DAYS old, oldest wait first.
 */

const DAY_MS = 86_400_000;
const WIB_MS = 7 * 3_600_000;
const UNREPLIED_LIMIT = 50;

function wibToday(now = new Date()): string {
  return new Date(now.getTime() + WIB_MS).toISOString().slice(0, 10);
}

function addDays(day: string, n: number): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

const oneDecimal = (v: number) => Math.round(v * 10) / 10;

export async function getLeadReport(p: { startDate?: string; endDate?: string }): Promise<LeadReport> {
  const endDay = p.endDate ?? wibToday();
  const startDay = p.startDate ?? addDays(endDay, -13);
  const start = wibDayStart(startDay);
  const endExcl = wibDayStart(addDays(endDay, 1));
  if (!start || !endExcl || endExcl <= start) throw new Error('invalid report range');
  const from = start.toISOString();
  const to = endExcl.toISOString();
  const db = getDb();

  const [tiles, contacted, daily, funnel, reasons, unreplied] = await Promise.all([
    db.execute<{ new_leads: number; returning: number; won: number; lost: number; won_now: number; avg_days: string | null }>(sql`
      SELECT
        count(*) FILTER (WHERE submitted_at >= ${from}::timestamptz AND submitted_at < ${to}::timestamptz)::int AS new_leads,
        count(*) FILTER (WHERE submitted_at >= ${from}::timestamptz AND submitted_at < ${to}::timestamptz
                           AND previous_lead_id IS NOT NULL)::int AS returning,
        count(*) FILTER (WHERE status = 'won'  AND closed_at >= ${from}::timestamptz AND closed_at < ${to}::timestamptz)::int AS won,
        count(*) FILTER (WHERE status = 'lost' AND closed_at >= ${from}::timestamptz AND closed_at < ${to}::timestamptz)::int AS lost,
        count(*) FILTER (WHERE status = 'won'  AND submitted_at >= ${from}::timestamptz AND submitted_at < ${to}::timestamptz)::int AS won_now,
        round((avg(extract(epoch FROM closed_at - coalesce(first_contact_at, matched_at, submitted_at)) / 86400.0)
          FILTER (WHERE status = 'won' AND closed_at >= ${from}::timestamptz AND closed_at < ${to}::timestamptz))::numeric, 1) AS avg_days
      FROM leads
      WHERE kind = 'lead'
    `),
    db.execute<{ n: number }>(sql`
      SELECT count(DISTINCT l.contact_id)::int AS n
      FROM leads l
      WHERE l.kind = 'lead' AND EXISTS (
        SELECT 1 FROM conversations cv JOIN messages m ON m.conversation_id = cv.id
        WHERE cv.contact_id = l.contact_id AND m.role = 'user'
          AND m.created_at >= ${from}::timestamptz AND m.created_at < ${to}::timestamptz)
    `),
    db.execute<{ day: string; new_leads: number; contacted: number }>(sql`
      SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
             coalesce(n.cnt, 0)::int AS new_leads,
             coalesce(c.cnt, 0)::int AS contacted
      FROM generate_series(${startDay}::date, ${endDay}::date, interval '1 day') AS d(day)
      LEFT JOIN (
        SELECT (submitted_at AT TIME ZONE 'Asia/Jakarta')::date AS day, count(*) AS cnt
        FROM leads
        WHERE kind = 'lead' AND submitted_at >= ${from}::timestamptz AND submitted_at < ${to}::timestamptz
        GROUP BY 1
      ) n ON n.day = d.day
      LEFT JOIN (
        SELECT (m.created_at AT TIME ZONE 'Asia/Jakarta')::date AS day, count(DISTINCT l.contact_id) AS cnt
        FROM leads l
        JOIN conversations cv ON cv.contact_id = l.contact_id
        JOIN messages m ON m.conversation_id = cv.id
        WHERE l.kind = 'lead' AND m.role = 'user'
          AND m.created_at >= ${from}::timestamptz AND m.created_at < ${to}::timestamptz
        GROUP BY 1
      ) c ON c.day = d.day
      ORDER BY d.day
    `),
    db.execute<{ status: LeadStatus; n: number }>(sql`
      SELECT status, count(*)::int AS n FROM leads
      WHERE kind = 'lead' AND submitted_at >= ${from}::timestamptz AND submitted_at < ${to}::timestamptz
      GROUP BY status
    `),
    db.execute<{ reason: LostReason | null; n: number }>(sql`
      SELECT lost_reason AS reason, count(*)::int AS n FROM leads
      WHERE kind = 'lead' AND status = 'lost' AND closed_at >= ${from}::timestamptz AND closed_at < ${to}::timestamptz
      GROUP BY lost_reason
      ORDER BY n DESC, lost_reason ASC NULLS LAST
    `),
    db.execute<{
      lead_id: string; name: string | null; wa_id: string | null; status: LeadStatus;
      last_message: string; waiting_since: Date | string;
    }>(sql`
      SELECT id AS lead_id, name, wa_id, status, last_message, waiting_since FROM (
        SELECT leads.id, leads.status, ct.display_name AS name, ct.wa_id,
               ${WAITING_SINCE_SQL} AS waiting_since,
               (SELECT m.body FROM messages m JOIN conversations cv ON cv.id = m.conversation_id
                 WHERE cv.contact_id = leads.contact_id AND m.role IN ('user', 'assistant')
                 ORDER BY m.created_at DESC LIMIT 1) AS last_message
        FROM leads LEFT JOIN contacts ct ON ct.id = leads.contact_id
        WHERE leads.kind = 'lead' AND ${IS_CURRENT_LEAD_SQL}
      ) w
      WHERE ${isRecentWaitSql(sql`waiting_since`)}
      ORDER BY waiting_since ASC
      LIMIT ${UNREPLIED_LIMIT}
    `),
  ]);

  const t = tiles.rows[0]!;
  const newLeads = Number(t.new_leads);
  const funnelOut = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0])) as Record<LeadStatus, number>;
  for (const r of funnel.rows) funnelOut[r.status] = Number(r.n);

  return {
    newLeads,
    returningLeads: Number(t.returning),
    contactedLeads: Number(contacted.rows[0]?.n ?? 0),
    won: Number(t.won),
    lost: Number(t.lost),
    conversionPct: newLeads === 0 ? null : oneDecimal((Number(t.won_now) / newLeads) * 100),
    avgDaysToClose: t.avg_days === null ? null : Number(t.avg_days),
    daily: daily.rows.map((r) => ({ day: r.day, newLeads: Number(r.new_leads), contacted: Number(r.contacted) })),
    funnel: funnelOut,
    lostReasons: reasons.rows.map((r) => ({ reason: r.reason, count: Number(r.n) })),
    unreplied: unreplied.rows.map((r) => ({
      leadId: r.lead_id,
      name: r.name,
      waId: r.wa_id,
      status: r.status,
      lastMessage: r.last_message,
      waitingSince: new Date(r.waiting_since).toISOString(),
    })),
  };
}
