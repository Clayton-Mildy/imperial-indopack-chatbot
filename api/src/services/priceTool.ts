/**
 * hitung_harga - the price calculator the model calls instead of doing price arithmetic.
 *
 * The model only ever repeats what this returns. The figures a call returns are also the only
 * figures the strict price check accepts in that turn (AIResponse.toolFigures), so a quote's
 * figures are exactly the Rp amounts its text prints, and every other outcome prints none - after
 * which no price is accepted at all (AIResponse.priceToolRan).
 *
 * Every result starts with one of four prefixes the prompt keys on:
 *   HARGA:                    a quote
 *   DI_BAWAH_MINIMUM:         below the lowest tier - explain the minimum, quote nothing
 *   DI_ATAS_TINGKAT_TERATAS:  above the top tier - big orders are negotiated by staff
 *   TIDAK_ADA_DI_KATALOG:     no such product or size, or no tiers - staff prices it; out of stock -
 *                             offer the ready sizes first
 */

import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { normalizeSize } from '../domain/orderProfile.js';
import { quotePrice, toPcs, type PriceTier, type QtyUnit } from '../domain/pricing.js';
import type { Product, ProductVariant } from '../domain/types.js';
import { getCatalogProducts } from './ragQuery.js';

export const PRICE_TOOL_NAME = 'hitung_harga';

export const PRICE_TOOL_DESC =
  'Calculate the price of one catalog item for the quantity the customer wants. You MUST call this before stating any price for a quantity, any total, or which tier applies, and repeat its figures exactly as returned - never do price arithmetic yourself. One call per item (product + size); for several items make several calls in the same turn. The result starts with HARGA: (the tier used, unit price, total, delivery, and the next tier to mention), DI_BAWAH_MINIMUM: (below the minimum order: explain the minimum, quote nothing), DI_ATAS_TINGKAT_TERATAS: (quote nothing: the team calculates it) or TIDAK_ADA_DI_KATALOG: (quote nothing; the result says why and what to offer instead).';

const PRICE_FIELD_DESC = {
  product: 'The product name as written after "Produk:" in the catalog block (the part before " — ").',
  size: 'The size exactly as written after "Ukuran:" under that product in the catalog block, e.g. "30 x 30 cm" or "20x20x7,5".',
  qty: 'How many the customer wants, as a plain number in `unit`: "2.500 pcs" is 2500, not 2.5.',
  unit: '"rim" or "pcs", the unit the customer\'s quantity is in (1 rim = 500 pcs).',
};

export const PriceToolInput = z.object({
  product: z.string().describe(PRICE_FIELD_DESC.product),
  size: z.string().describe(PRICE_FIELD_DESC.size),
  qty: z.number().describe(PRICE_FIELD_DESC.qty),
  unit: z.enum(['rim', 'pcs']).describe(PRICE_FIELD_DESC.unit),
});
export type PriceToolInputType = z.infer<typeof PriceToolInput>;

/** The same contract as PriceToolInput, as the Messages API tool definition. */
export const PRICE_TOOL: Anthropic.Tool = {
  name: PRICE_TOOL_NAME,
  description: PRICE_TOOL_DESC,
  input_schema: {
    type: 'object' as const,
    properties: {
      product: { type: 'string', description: PRICE_FIELD_DESC.product },
      size: { type: 'string', description: PRICE_FIELD_DESC.size },
      qty: { type: 'number', description: PRICE_FIELD_DESC.qty },
      unit: { type: 'string', enum: ['rim', 'pcs'], description: PRICE_FIELD_DESC.unit },
    },
    required: ['product', 'size', 'qty', 'unit'],
  },
};

export { normalizeSize };

export interface PriceToolResult {
  text: string;
  figures: number[];
}

const num = (n: number): string => n.toLocaleString('id-ID');
const rp = (n: number): string => `Rp ${num(n)}`;
const qtyText = (qty: number, unit: QtyUnit): string =>
  unit === 'rim' ? `${num(qty)} rim (${num(toPcs(qty, 'rim'))} pcs)` : `${num(qty)} pcs`;
const tierStart = (t: PriceTier): string => `mulai ${qtyText(t.minQty, t.qtyUnit)}`;
const delivery = (included: boolean): string => (included ? 'sudah termasuk ongkir' : 'belum termasuk ongkir');

// "64gsm" and "64 gsm" are one gramasi.
const words = (s: string): string[] =>
  s.toLowerCase().replace(/(\d)\s*gsm\b/g, '$1 gsm').split(/[^\p{L}\p{N}]+/u).filter(Boolean);

// The catalog block prints "Produk: <name> — <description>", and an imported product's description is
// its spec columns ("Gramasi: 64 gsm · Cetak: 1 warna"), so a model copying the whole line sends both.
const DESCRIPTION_SUFFIX_RE = /\s+[—–-]\s+.*$/s;

function exactOrContaining(catalog: Product[], query: string): Product[] {
  const q = words(query);
  if (q.length === 0) return [];
  const exact = catalog.filter((p) => words(p.name).join(' ') === q.join(' '));
  if (exact.length > 0) return exact;
  return catalog.filter((p) => {
    const name = new Set(words(p.name));
    return q.every((w) => name.has(w));
  });
}

/**
 * Exact name first (case, spacing and punctuation aside), then the one product whose name holds every
 * input word - for the query as sent, and failing that without a " — description" suffix (a name that
 * itself holds " - " still matches as sent). None, or more than one, is no match: a guessed product is
 * a wrong price.
 */
function matchProduct(catalog: Product[], query: string): Product | Product[] {
  const asSent = catalog.filter((p) => words(p.name).join(' ') === words(query).join(' '));
  const stripped = query.replace(DESCRIPTION_SUFFIX_RE, '');
  const found = asSent.length > 0 ? asSent : exactOrContaining(catalog, stripped);
  return found.length === 1 ? found[0]! : found;
}

/**
 * Up to three product names sharing the most words with the query, for a no-match result: the model
 * calls again with one of them instead of handing an in-catalog item to the team (Pricing rule d).
 */
function closestNames(catalog: Product[], query: string): string[] {
  const q = new Set(words(query.replace(DESCRIPTION_SUFFIX_RE, '')));
  return catalog
    .map((p) => {
      const name = words(p.name);
      const shared = name.filter((w) => q.has(w)).length;
      return { name: p.name, shared, extra: name.length - shared };
    })
    .filter((c) => c.shared > 0)
    .sort((a, b) => b.shared - a.shared || a.extra - b.extra || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map((c) => c.name);
}

const NO_PRICE = 'Jangan sebut harga untuk item ini; harganya dihitung tim kami.';

/** The product's sizes that are in stock, one entry per size however many variants share it. */
function readySizes(active: ProductVariant[]): string[] {
  const ready: string[] = [];
  const seen = new Set<string>();
  for (const v of active) {
    const key = normalizeSize(v.name);
    if (v.stockStatus === 'no_stock' || seen.has(key)) continue;
    seen.add(key);
    ready.push(v.name);
  }
  return ready;
}
const notInCatalog = (reason: string): PriceToolResult => ({ text: `TIDAK_ADA_DI_KATALOG: ${reason} ${NO_PRICE}`, figures: [] });

export async function runPriceTool(input: PriceToolInputType, catalog?: Product[]): Promise<PriceToolResult> {
  let source: Product[];
  try {
    source = catalog ?? (await getCatalogProducts());
  } catch (err) {
    // One place for both call paths: an unreadable catalog prices nothing, but must not fail the
    // whole turn - the model hands this item to the team and answers the rest.
    console.error('[priceTool] catalog load failed:', err instanceof Error ? err.message : err);
    return { text: `TIDAK_ADA_DI_KATALOG: Harga tidak bisa dihitung saat ini (katalog gagal dimuat). ${NO_PRICE}`, figures: [] };
  }
  // Same universe as the catalog block the model reads: only products with an active variant.
  const products = source.filter((p) => (p.variants ?? []).some((v) => v.isActive));

  const match = matchProduct(products, input.product);
  if (Array.isArray(match)) {
    if (match.length > 1) {
      return notInCatalog(`"${input.product}" cocok dengan lebih dari satu produk (${match.slice(0, 5).map((p) => p.name).join('; ')}). Panggil lagi dengan nama produk persis seperti di katalog.`);
    }
    const closest = closestNames(products, input.product);
    return notInCatalog(`Produk "${input.product}" tidak ada di katalog.${closest.length > 0
      ? ` Nama produk terdekat di katalog: ${closest.join('; ')}. Kalau salah satunya yang dimaksud pelanggan, panggil hitung_harga lagi dengan nama itu persis.`
      : ''}`);
  }
  const product = match;

  const active = (product.variants ?? []).filter((v) => v.isActive);
  const sizes = active.filter((v) => normalizeSize(v.name) === normalizeSize(input.size));
  if (sizes.length > 1) {
    // Two variants the import let through with one size (e.g. "30 x 30 cm" and "30x30"): which
    // tiers are right is the team's call, never a guess.
    return notInCatalog(`${product.name} punya lebih dari satu varian dengan ukuran "${input.size}" (${sizes.map((v) => v.name).join('; ')}); tim kami perlu memeriksanya.`);
  }
  if (sizes.length === 0) {
    const ready = readySizes(active);
    return notInCatalog(`${product.name} ukuran "${input.size}" tidak ada di katalog.${ready.length ? ` Ukuran yang ada: ${ready.join(', ')}.` : ''}`);
  }
  const variant: ProductVariant = sizes[0]!;
  const item = `${product.name} ukuran ${variant.name}`;

  // Out of stock: the catalog block prints no price for it, so neither does this. Every other
  // status (price_rise / price_drop included) has its tiers in the block and is quoted from them.
  // The prompt's STOK HABIS rule: offer the ready sizes first; the team only if the customer insists.
  if (variant.stockStatus === 'no_stock') {
    const ready = readySizes(active);
    return {
      text: `TIDAK_ADA_DI_KATALOG: ${item} sedang kosong (stok habis).${ready.length ? ` Ukuran yang ready: ${ready.join(', ')}.` : ''} Jangan sebut harga untuk ukuran ini; ${ready.length ? 'tawarkan dulu ukuran yang ready' : 'sampaikan kosong'}, dan serahkan ke tim hanya kalau pelanggan tetap mau ukuran ini.`,
      figures: [],
    };
  }

  const quote = quotePrice(variant.priceTiers ?? [], input.qty, input.unit);
  switch (quote.kind) {
    case 'no_tiers':
      return notInCatalog(`${item} belum punya harga di katalog.`);
    case 'below_minimum':
      return {
        text: `DI_BAWAH_MINIMUM: Minimal pemesanan ${item} adalah ${qtyText(quote.minimum.minQty, quote.minimum.qtyUnit)}; ${qtyText(input.qty, input.unit)} belum mencapai minimal itu. Jelaskan minimalnya ke pelanggan, jangan sebut harga.`,
        figures: [],
      };
    case 'above_top_tier':
      return {
        text: `DI_ATAS_TINGKAT_TERATAS: Pesanan ${qtyText(input.qty, input.unit)} ${item} melebihi tingkat harga teratas di katalog, yaitu ${qtyText(quote.top.minQty, quote.top.qtyUnit)}. Harga untuk jumlah sebesar ini dihitung tim kami; jangan sebut harga.`,
        figures: [],
      };
    case 'quote': {
      const { tier, nextTier } = quote;
      const unitPrice = `${rp(quote.unitPriceIdr)}/${tier.priceUnit}`;
      const lines = [
        `HARGA: ${item}, ${qtyText(input.qty, input.unit)}.`,
        `Tingkat harga ${tierStart(tier)}: ${unitPrice}, ${delivery(quote.includesDelivery)}${tier.note ? ` (${tier.note})` : ''}.`,
        `Total: ${num(quote.qtyInPriceUnit)} ${tier.priceUnit} x ${rp(quote.unitPriceIdr)} = ${rp(quote.totalIdr)}.`,
        ...(nextTier
          ? [`Tingkat berikutnya ${tierStart(nextTier)}: ${rp(nextTier.priceIdr)}/${nextTier.priceUnit}, ${delivery(nextTier.includesDelivery)}.`]
          : []),
        'Sampaikan angka-angka ini persis seperti tertulis.',
      ];
      return {
        text: lines.join('\n'),
        figures: [quote.unitPriceIdr, quote.totalIdr, ...(nextTier ? [nextTier.priceIdr] : [])],
      };
    }
  }
}
