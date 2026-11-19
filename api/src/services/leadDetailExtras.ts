/**
 * The extras on the lead detail: where the customer came from (a click-to-WhatsApp ad or a direct
 * chat), when the PO form link went out, how fast the deal closed, and the price the bot quoted per
 * item. Everything is read from the contact's chat since the lead began.
 */
import { sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { PO_FORM_LINK_ROW_SQL } from '../repositories/conversations.js';
import { getCatalogProducts } from './ragQuery.js';
import { nearestCatalogItems } from './nearestCatalog.js';
import { normalizeGsm, sameGsm } from '../domain/gramasi.js';
import type { Lead } from '../domain/types.js';
import type { QtyUnit } from '../domain/pricing.js';
import type { PriceToolCall } from './priceTool.js';

export interface QuotedPrice { unitPriceIdr: number; priceUnit: QtyUnit; totalIdr: number; at: string }
export interface LeadDetailExtras {
  source: { kind: 'ad' | 'direct'; headline: string | null };
  poFormSentAt: string | null;
  closingMinutes: number | null;
  quotedPrices: (QuotedPrice | null)[];
}

const iso = (v: Date | string): string => new Date(v).toISOString();

/** A price call as stored in a message's metadata: one stored before gramasi were options has no gsm field. */
type StoredPriceCall = Omit<PriceToolCall, 'gsm'> & { gsm?: string | null };

export async function getLeadDetailExtras(lead: Lead): Promise<LeadDetailExtras> {
  const began = lead.firstContactAt ?? lead.submittedAt;
  const closingMinutes =
    lead.status === 'won' && lead.closedAt ? Math.round((lead.closedAt.getTime() - began.getTime()) / 60_000) : null;

  let source: LeadDetailExtras['source'] = { kind: 'direct', headline: null };
  let poFormSentAt: string | null = null;
  let calls: { at: string; call: StoredPriceCall }[] = [];

  if (lead.contactId) {
    const db = getDb();
    const since = began.toISOString();
    const mine = sql`cv.contact_id = ${lead.contactId} AND m.created_at >= ${since}::timestamptz`;
    const [first, po, priced] = await Promise.all([
      db.execute<{ referral: { sourceType?: string | null; headline?: string | null } | null }>(sql`
        SELECT m.metadata->'referral' AS referral FROM messages m
        JOIN conversations cv ON cv.id = m.conversation_id
        WHERE ${mine} AND m.role = 'user'
        ORDER BY m.created_at ASC, m.id ASC LIMIT 1`),
      db.execute<{ at: Date | string | null }>(sql`
        SELECT MAX(m.created_at) AS at FROM messages m
        JOIN conversations cv ON cv.id = m.conversation_id
        WHERE ${mine} AND ${PO_FORM_LINK_ROW_SQL}`),
      db.execute<{ at: Date | string; calls: PriceToolCall[] }>(sql`
        SELECT m.created_at AS at, m.metadata->'priceCalls' AS calls FROM messages m
        JOIN conversations cv ON cv.id = m.conversation_id
        WHERE ${mine} AND m.role = 'assistant' AND jsonb_typeof(m.metadata->'priceCalls') = 'array'
        ORDER BY m.created_at DESC, m.id DESC`),
    ]);
    const ref = first.rows[0]?.referral;
    if (ref && ref.sourceType === 'ad') source = { kind: 'ad', headline: ref.headline ?? null };
    const at = po.rows[0]?.at;
    poFormSentAt = at ? iso(at) : null;
    // Newest first, and within a row the last call is the newest.
    calls = priced.rows.flatMap((r) => [...r.calls].reverse().map((call) => ({ at: iso(r.at), call })));
  }

  let quotedPrices: (QuotedPrice | null)[] = lead.items.map(() => null);
  if (lead.items.length > 0 && calls.length > 0) {
    const catalog = await getCatalogProducts();
    quotedPrices = lead.items.map((item) => {
      // One exact match: the item's gramasi picked it, or the product has only one.
      const found = nearestCatalogItems(item, catalog);
      const m = found.length === 1 ? found[0]! : undefined;
      if (!m || !m.exact || (normalizeGsm(item.gsm) && !sameGsm(item.gsm, m.gsm))) return null;
      const hit = calls.find(
        ({ call }) =>
          call.outcome === 'quote' && call.productName === m.productName && call.variantName === m.variantName &&
          // An old call (no gsm field) was made when the product had one gramasi: it matches any.
          (call.gsm === undefined || sameGsm(call.gsm, m.gsm)) && call.quote?.kind === 'quote'
      );
      if (!hit || hit.call.quote?.kind !== 'quote') return null;
      const q = hit.call.quote;
      return { unitPriceIdr: q.unitPriceIdr, priceUnit: q.tier.priceUnit, totalIdr: q.totalIdr, at: hit.at };
    });
  }

  return { source, poFormSentAt, closingMinutes, quotedPrices };
}
