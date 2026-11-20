/**
 * A price staff named in the chat (QA 2026-11-19, A3). Staff negotiate in the chat - from the dashboard
 * or on the WhatsApp phone ("buletin ke 3 juta") - and then hand it back to the bot. The bot's checks
 * only knew catalog and calculator figures, so the agreement that followed was "repaired" into a catalog
 * total and sent with the PO form: the customer agreed to one price and got the form at another.
 *
 * Staff rows are assistant rows with a senderName (dashboard sends, phone replies imported by chakraSync);
 * the bot's own rows have none.
 */

export interface PricedMessage {
  role: string;
  body: string;
  senderName?: string | null;
  metadata?: Record<string, unknown> | null;
}

// Counts, not prices: "10 ribu pcs", "3 jt lembar".
const QTY_UNIT = String.raw`(?:pcs|pc|lembar|lbr|rim|box|dus|biji|buah|unit|pack|karton|ctn|kg|gr|gram)\b`;
const NUM = String.raw`\d+(?:[.,]\d+)*`;
const FIGURE_RE = new RegExp([
  // "Rp 4.500.000", "Rp1.150", "Rp 8 juta", "Rp 4,5jt"
  String.raw`\bRp\.?\s*(?<rp>${NUM})(?:\s*(?<rpUnit>rb|ribu|k|jt|juta)\b)?`,
  // "3 juta", "4,5jt", "185rb", "185 ribu", "185k" - not a count
  String.raw`(?<![\d.,])\b(?<informal>${NUM})\s*(?<unit>rb|ribu|k|jt|juta)\b(?!\s*${QTY_UNIT})`,
  // "1.150/pcs", "185 per pcs", "2.000 per lembar" - per unit
  String.raw`(?<![\d.,])\b(?<perUnit>\d+(?:[.,]\d{3})*)\s*(?:\/\s*|per\s+)(?:pcs|pc|rim|lembar|lbr|box)\b`,
  // "harga 4.500.000 ya", "jadi 4500000 aja", "deal 3.000.000" - a price word, then a figure of 1.000 or more
  String.raw`\b(?:harga(?:nya)?|jadi|jd|total(?:nya)?|deal|nego|diskon|bulet\w*|bulat\w*|cuma|hanya)\b[^\d\n]{0,12}(?<![\d.,])(?<afterWord>\d{1,3}(?:[.,]\d{3})+|\d{4,9})\b(?![.,]\d)(?!\s*${QTY_UNIT})`,
].join('|'), 'gi');

// A figure that is not the deal's price: shipping, a down payment, a minimum, an order size ("ongkir 25rb",
// "DP 50%", "minimal order 20k").
const NOT_THE_PRICE_BEFORE_RE = /\b(?:ongkir|ongkos|dp|uang\s+muka|minimal|minimum|min|order|pesan|qty|jumlah)\b[^\d\n]{0,12}$/i;

const MULTIPLIER: Record<string, number> = { rb: 1_000, ribu: 1_000, k: 1_000, jt: 1_000_000, juta: 1_000_000 };

/** "4,5" or "4.5" with a unit is a decimal; "4.500.000" is thousands. */
function scaled(raw: string, unit: string): number {
  const m = MULTIPLIER[unit.toLowerCase()] ?? 1;
  const decimal = /^\d+[.,]\d{1,2}$/.test(raw);
  const n = decimal ? Number(raw.replace(',', '.')) : Number(raw.replace(/\D/g, ''));
  return Math.round(n * m);
}

/** Every rupiah figure a text names as a price, in order. */
export function priceFiguresIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(FIGURE_RE)) {
    if (NOT_THE_PRICE_BEFORE_RE.test(text.slice(Math.max(0, (m.index ?? 0) - 20), m.index))) continue;
    const g = m.groups ?? {};
    if (g.rp) out.push(g.rpUnit ? scaled(g.rp, g.rpUnit) : wholeRupiah(g.rp));
    else if (g.informal && g.unit) out.push(scaled(g.informal, g.unit));
    else if (g.perUnit) out.push(wholeRupiah(g.perUnit));
    else if (g.afterWord) out.push(wholeRupiah(g.afterWord));
  }
  return out.filter((n) => Number.isFinite(n) && n > 0);
}

/** "1.150" is 1150; "1.150,50" is 1150 (sen dropped); "4500000" is itself. */
function wholeRupiah(raw: string): number {
  return Number(raw.replace(/,\d{1,2}$/, '').replace(/\D/g, ''));
}

const closesDeal = (m: PricedMessage): boolean => m.role === 'assistant' && !m.senderName && m.metadata?.source === 'po_form';
const isStaff = (m: PricedMessage): boolean => m.role === 'assistant' && Boolean(m.senderName);
const botQuoted = (m: PricedMessage): boolean =>
  m.role === 'assistant' && !m.senderName
  && (priceFiguresIn(m.body).length > 0 || (Array.isArray(m.metadata?.priceCalls) && m.metadata.priceCalls.length > 0));

/**
 * The staff message whose price stands: the newest message in `recent` (oldest first) that names a
 * price, when staff wrote it. A later bot quote replaces it, and so does a PO form row (the bot's form,
 * or its promise that the team sends it): that deal is closed, and a later "oke" is a new one. The
 * customer's own figures never count.
 */
export function standingStaffPrice(recent: PricedMessage[]): { body: string; figures: number[] } | null {
  for (let i = recent.length - 1; i >= 0; i--) {
    const m = recent[i]!;
    if (botQuoted(m) || closesDeal(m)) return null;
    if (isStaff(m)) {
      const figures = priceFiguresIn(m.body);
      if (figures.length > 0) return { body: m.body, figures };
    }
  }
  return null;
}
