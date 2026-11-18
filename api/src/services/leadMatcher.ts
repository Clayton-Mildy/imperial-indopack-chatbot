import { claimLeadByRequestId, ensureOrganicLead } from '../repositories/leads.js';

/**
 * Lead attribution from the inbound message itself.
 *
 * Marketing's landing-page forms hand the visitor to WhatsApp with a prefilled template
 * whose last line is the form submission's UUID. Production carries:
 *
 *   Legacy
 *
 *   Nama: budi
 *   Nomor WhatsApp: 081200000001
 *   Apa Yang Anda Butuhkan?: saya mau kulak gembok yang murah
 *   Area: Kota Malang
 *   Budget: menyesuaikan
 *
 *   Request ID: ada4cdd9-085f-43f2-8629-a55a84600cef
 *
 * The UTM data is NOT in the message - only marketing's Excel export has it, which is why
 * the two halves meet on request_id rather than arriving together.
 */

// Matches anywhere in the body, tolerating WhatsApp bold (*Request ID:*) and odd spacing -
// production has one submission with the customer's own greeting merged in front of the
// template. Label-anchored on purpose: a bare-UUID scan would turn any UUID-shaped text a
// customer pastes into a junk campaign lead.
const REQUEST_ID_RE =
  /request\s*id\b[^0-9a-f]{0,5}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

// The template is "Label: value" lines, and the labels vary per form - production shows
// three different field sets across fifteen submissions, and the screenshot from marketing
// shows a fourth. So take whatever labels are there rather than naming any of them.
const FIELD_RE = /^\s*([A-Za-z][A-Za-z0-9 ?/&()'-]{0,40}?)\s*:\s*(\S.*?)\s*$/;

const MAX_FIELDS = 20;
const MAX_VALUE_LEN = 500;

export function extractRequestId(message: string): string | null {
  return REQUEST_ID_RE.exec(message)?.[1]?.toLowerCase() ?? null;
}

function toKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

/**
 * Pull the template's form answers out of the message body.
 *
 * Only ever called on a message that already matched a Request ID, so ordinary chat lines
 * that happen to contain a colon never become payload.
 */
export function extractFormFields(message: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of message.split('\n')) {
    if (Object.keys(fields).length >= MAX_FIELDS) break;
    if (/^\s*https?:\/\//i.test(line)) continue;
    const match = FIELD_RE.exec(line);
    if (!match) continue;
    const key = toKey(match[1]!);
    if (!key || key === 'request_id') continue;
    fields[key] = match[2]!.slice(0, MAX_VALUE_LEN);
  }
  return fields;
}

/**
 * Record the lead behind an inbound message: a campaign lead when the template's Request ID
 * is present, an organic one otherwise.
 *
 * `at` is the message's own timestamp so backfilled history keeps honest dates - the
 * campaign report buckets on submitted_at.
 *
 * Never throws: lead bookkeeping must not be able to break the inbound message path.
 */
export async function recordLeadFromMessage(
  message: string,
  contactId: string,
  at: Date = new Date()
): Promise<void> {
  try {
    const requestId = extractRequestId(message);
    if (requestId) {
      await claimLeadByRequestId(requestId, contactId, extractFormFields(message), at);
    } else {
      await ensureOrganicLead(contactId, at);
    }
  } catch (err) {
    console.warn('[leadMatcher] failed to record lead:', err instanceof Error ? err.message : err);
  }
}
