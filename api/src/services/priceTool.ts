/**
 * hitung_harga - the price calculator the model calls instead of doing price arithmetic.
 *
 * The model only ever repeats what this returns. The figures a call returns are also the only
 * figures the strict price check accepts in that turn (AIResponse.toolFigures), so a quote's
 * figures are exactly the Rp amounts its text prints, and every other outcome prints none.
 *
 * Every result starts with one of four prefixes the prompt keys on:
 *   HARGA:                    a quote
 *   DI_BAWAH_MINIMUM:         below the lowest tier - explain the minimum, quote nothing
 *   DI_ATAS_TINGKAT_TERATAS:  above the top tier - big orders are negotiated by staff
 *   TIDAK_ADA_DI_KATALOG:     no such product or size, out of stock, or no tiers - staff prices it
 */

import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { quotePrice, toPcs, type PriceTier, type QtyUnit } from '../domain/pricing.js';
import type { Product, ProductVariant } from '../domain/types.js';
import { getCatalogProducts } from './ragQuery.js';

export const PRICE_TOOL_NAME = 'hitung_harga';

export const PRICE_TOOL_DESC =
  'Calculate the price of one catalog item for the quantity the customer wants. You MUST call this before stating any price for a quantity, any total, or which tier applies, and repeat its figures exactly as returned - never do price arithmetic yourself. One call per item (product + size); for several items make several calls in the same turn. The result starts with HARGA: (the tier used, unit price, total, delivery, and the next tier to mention), DI_BAWAH_MINIMUM: (below the minimum order: explain the minimum, quote nothing), DI_ATAS_TINGKAT_TERATAS: or TIDAK_ADA_DI_KATALOG: (quote nothing: the team calculates it).';

const PRICE_FIELD_DESC = {
  product: 'The product name exactly as written after "Produk:" in the catalog block.',
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

/** '30 x 30 cm', '30*30', '30×30' and '30 X 30' are all '30x30'; '7,5' and '7.5' are the same. */
export function normalizeSize(s: string): string {
  return s.toLowerCase().replace(/[×*]/g, 'x').replace(/cm/g, '').replace(/,/g, '.').replace(/\s+/g, '');
}

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

const words = (s: string): string[] => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * Exact name first (case and punctuation aside), then the one product whose name holds every input
 * word. None, or more than one, is no match: a guessed product is a wrong price.
 */
function matchProduct(catalog: Product[], query: string): Product | Product[] {
  const q = words(query);
  if (q.length === 0) return [];
  const exact = catalog.filter((p) => words(p.name).join(' ') === q.join(' '));
  if (exact.length > 0) return exact.length === 1 ? exact[0]! : exact;
  const containing = catalog.filter((p) => {
    const name = new Set(words(p.name));
    return q.every((w) => name.has(w));
  });
  return containing.length === 1 ? containing[0]! : containing;
}

const NO_PRICE = 'Jangan sebut harga untuk item ini; harganya dihitung tim kami.';
const notInCatalog = (reason: string): PriceToolResult => ({ text: `TIDAK_ADA_DI_KATALOG: ${reason} ${NO_PRICE}`, figures: [] });

export async function runPriceTool(input: PriceToolInputType, catalog?: Product[]): Promise<PriceToolResult> {
  // Same universe as the catalog block the model reads: only products with an active variant.
  const products = (catalog ?? (await getCatalogProducts())).filter((p) => (p.variants ?? []).some((v) => v.isActive));

  const match = matchProduct(products, input.product);
  if (Array.isArray(match)) {
    return notInCatalog(match.length > 1
      ? `"${input.product}" cocok dengan lebih dari satu produk (${match.slice(0, 5).map((p) => p.name).join('; ')}). Panggil lagi dengan nama produk persis seperti di katalog.`
      : `Produk "${input.product}" tidak ada di katalog.`);
  }
  const product = match;

  const active = (product.variants ?? []).filter((v) => v.isActive);
  const sizes = active.filter((v) => normalizeSize(v.name) === normalizeSize(input.size));
  if (sizes.length !== 1) {
    const ready = active.filter((v) => v.stockStatus !== 'no_stock').map((v) => v.name);
    return notInCatalog(`${product.name} ukuran "${input.size}" tidak ada di katalog.${ready.length ? ` Ukuran yang ada: ${ready.join(', ')}.` : ''}`);
  }
  const variant: ProductVariant = sizes[0]!;
  const item = `${product.name} ukuran ${variant.name}`;

  // Out of stock: the catalog block prints no price for it, so neither does this. Every other
  // status (price_rise / price_drop included) has its tiers in the block and is quoted from them.
  if (variant.stockStatus === 'no_stock') return notInCatalog(`${item} sedang kosong (stok habis).`);

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
