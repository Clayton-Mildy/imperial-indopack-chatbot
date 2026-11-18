/**
 * The order facts collected in the chat (spec 7.3): which brands the customer is buying, and the
 * items. Stored in contact_profiles.profile (`brands`, `items`) and on leads.
 */

/** The two brands, as stored. */
export type BrandSlug = 'imperial_indopack' | 'kertas_supreme';

/** brands.name of each slug - the rows migration 0026 seeds. */
export const BRAND_NAMES: Record<BrandSlug, string> = {
  imperial_indopack: 'Imperial Indopack',
  kertas_supreme: 'Kertas Supreme',
};

/** '30 x 30 cm', '30*30', '30×30' and '30 X 30' are all '30x30'; '7,5' and '7.5' are the same. */
export function normalizeSize(s: string): string {
  return s.toLowerCase().replace(/[×*]/g, 'x').replace(/cm/g, '').replace(/,/g, '.').replace(/\s+/g, '');
}

export interface OrderItem {
  product?: string;
  size?: string;
  gsm?: string;
  print?: string;
  qty?: number;
  qty_unit?: 'rim' | 'pcs';
  has_design?: boolean;
}

const BRAND_SLUGS: readonly string[] = ['imperial_indopack', 'kertas_supreme'];

/** Identity of an item across turns: the same product in the same size, however it is spelled. */
export function itemKey(i: OrderItem): string {
  return `${str(i.product).toLowerCase()}|${normalizeSize(str(i.size))}`;
}

/** A trimmed non-empty string; finite numbers become strings; anything else is ''. */
function str(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

function parseQty(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : undefined;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (!t) return undefined;
  // "2.500" is two thousand five hundred (dots are thousands separators), "2,5" is 2.5
  const n = /^\d{1,3}(\.\d{3})+$/.test(t) ? Number(t.replace(/\./g, '')) : Number(t.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseUnit(v: unknown): 'rim' | 'pcs' | undefined {
  if (typeof v !== 'string') return undefined;
  const u = v.trim().toLowerCase();
  if (u === 'rim') return 'rim';
  if (u === 'pcs' || u === 'lembar') return 'pcs';
  return undefined;
}

/** Keep only well-typed fields of a model-sent (or stored) item. */
export function sanitizeItem(raw: Record<string, unknown>): OrderItem {
  const out: OrderItem = {};
  for (const k of ['product', 'size', 'gsm', 'print'] as const) {
    const v = str(raw[k]);
    if (v) out[k] = v;
  }
  const qty = parseQty(raw.qty);
  if (qty !== undefined) out.qty = qty;
  const unit = parseUnit(raw.qty_unit);
  if (unit) out.qty_unit = unit;
  if (typeof raw.has_design === 'boolean') out.has_design = raw.has_design;
  return out;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Patch fields that were actually sent (not undefined/null/'') over the existing item; product and size are its identity, so the stored spelling stays. */
function mergeItem(existing: OrderItem, patch: OrderItem): OrderItem {
  const out: Record<string, unknown> = { ...existing };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null || v === '') continue;
    if ((k === 'product' || k === 'size') && out[k]) continue;
    out[k] = v;
  }
  return out as OrderItem;
}

/**
 * Merge one turn's profile_update into the stored facts. Plain keys overwrite; `brands` is a union
 * of known slugs; `items` is matched by itemKey: a known item takes only the fields sent, a new
 * one is appended. Neither array is ever replaced wholesale, so a chat that moves from paper to
 * boxes keeps both. An item with neither product nor size is dropped, except its has_design, which
 * becomes the order-level `has_design`.
 */
export function mergeOrderFacts(existing: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...existing };
  for (const [k, v] of Object.entries(patch)) {
    if (k !== 'brands' && k !== 'items') out[k] = v;
  }

  if ('brands' in patch) {
    const have = Array.isArray(existing.brands) ? existing.brands : [];
    const sent = Array.isArray(patch.brands) ? patch.brands : [];
    const brands: string[] = [];
    for (const b of [...have, ...sent]) {
      if (typeof b === 'string' && BRAND_SLUGS.includes(b) && !brands.includes(b)) brands.push(b);
    }
    out.brands = brands;
  }

  if ('items' in patch) {
    const items = (Array.isArray(existing.items) ? existing.items : []).filter(isRecord).map(sanitizeItem);
    const sentAll = (Array.isArray(patch.items) ? patch.items : []).filter(isRecord).map(sanitizeItem);
    // "Logo saya sudah ada kak" before any product or size is known: a design fact with no item to
    // hang on. It is the order's (top-level has_design) rather than dropped with the keyless item -
    // dropped, the hand-off asked "apakah sudah ada desain atau logo...?" right after it.
    const designOnly = sentAll.find((i) => itemKey(i) === '|' && i.has_design !== undefined);
    if (designOnly) out.has_design = designOnly.has_design;
    const sent = sentAll.filter((i) => itemKey(i) !== '|');
    const merged = items;
    for (const item of sent) {
      const idx = merged.findIndex((m) => itemKey(m) === itemKey(item));
      if (idx >= 0) merged[idx] = mergeItem(merged[idx]!, item);
      else merged.push(mergeItem({}, item));
    }
    out.items = merged;
  }
  return out;
}

function itemLine(i: OrderItem): string {
  const parts: string[] = [];
  i = sanitizeItem(i as Record<string, unknown>); // stored data may predate validation
  const name = [i.product, i.gsm && !(i.product ?? '').toLowerCase().includes(i.gsm.toLowerCase()) ? `${i.gsm} gsm` : '']
    .filter(Boolean).join(' ');
  if (name || i.print) parts.push([name, i.print ? `cetak ${i.print}` : ''].filter(Boolean).join(' '));
  if (i.size) parts.push(normalizeSize(i.size));
  if (i.qty !== undefined) parts.push(`${i.qty} ${i.qty_unit ?? ''}`.trim());
  if (i.has_design !== undefined) parts.push(`desain: ${i.has_design ? 'ada' : 'belum ada'}`);
  return parts.join(', ');
}

/**
 * The order details for the staff hand-off note. Unknown parts are left out, never printed as
 * "?" or "undefined": no name means no Nama line, an item without a size has no size part.
 */
export function orderDetailsSummary(facts: Record<string, unknown>): string {
  const lines: string[] = [];
  const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  if (text(facts.name)) lines.push(`Nama: ${text(facts.name)}`);
  if (text(facts.business_name)) lines.push(`Usaha: ${text(facts.business_name)}`);
  if (text(facts.business_type)) lines.push(`Jenis usaha: ${text(facts.business_type)}`);
  const items = Array.isArray(facts.items) ? facts.items.filter(isRecord) as OrderItem[] : [];
  for (const i of items) {
    const line = itemLine(i);
    if (line) lines.push(`Barang: ${line}`);
  }
  // The order-level design fact (see mergeOrderFacts): said before any item was known.
  if (typeof facts.has_design === 'boolean') lines.push(`Desain: ${facts.has_design ? 'ada' : 'belum ada'}`);
  return lines.join('\n');
}
