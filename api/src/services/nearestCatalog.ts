/**
 * "Terdekat di katalog" on the conversation panel: for an item the customer asked for, the catalog
 * product that shares the most words with it, that product's variant with the closest dimensions,
 * and what its quantity costs there. The team quotes a custom size from it, so it never decides
 * anything for the customer - `exact` says whether the catalog really has the size.
 *
 * Pure: the caller passes the catalog (getCatalogProducts, the list the bot quotes from).
 */

import type { Product, ProductVariant } from '../domain/types.js';
import { normalizeSize, type OrderItem } from '../domain/orderProfile.js';
import { lowestTier, quotePrice, type PriceQuote, type PriceTier } from '../domain/pricing.js';

export interface NearestMatch {
  item: OrderItem;
  productId: string;
  productName: string;
  variantName: string;
  /** The catalog has the size itself (same normalizeSize), not just a close one. */
  exact: boolean;
  /** quotePrice for the item's quantity; null when the quantity or its unit is unknown. */
  quote: PriceQuote | null;
  /** The quote's tier, else the variant's lowest tier; null when the variant has no tiers. */
  tier: PriceTier | null;
}

const DIMS = /^\d+(\.\d+)?(x\d+(\.\d+)?)*$/;

/** '22×22×7' -> [22, 22, 7]; '20 x 20 x 7,5 cm' -> [20, 20, 7.5]; anything that is not numbers joined by x -> null. */
export function parseSizeDims(size: string): number[] | null {
  const s = normalizeSize(size);
  return DIMS.test(s) ? s.split('x').map(Number) : null;
}

const words = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2);

/** How many of the item's words are words of the product name. */
function sharedWords(itemWords: string[], name: string): number {
  const nameWords = new Set(words(name));
  return itemWords.filter((w) => nameWords.has(w)).length;
}

const activeVariants = (p: Product): ProductVariant[] => (p.variants ?? []).filter((v) => v.isActive);

export function nearestCatalogItem(item: OrderItem, catalog: Product[]): NearestMatch | null {
  const dims = item.size ? parseSizeDims(item.size) : null;
  if (!item.size || !dims) return null;
  const itemWords = [...new Set(words(item.product ?? ''))];

  // The product: the most shared words, at least one; a tie goes to the name that sorts first.
  let product: Product | null = null;
  let best = 0;
  for (const p of catalog) {
    if (p.isActive === false || activeVariants(p).length === 0) continue;
    const n = sharedWords(itemWords, p.name);
    if (n > best || (n === best && n > 0 && product && p.name.localeCompare(product.name) < 0)) {
      product = p;
      best = n;
    }
  }
  if (!product) return null;

  // The variant: as many dimensions as the item, the smallest total difference (the first on a tie).
  let variant: ProductVariant | null = null;
  let distance = Infinity;
  for (const v of activeVariants(product)) {
    const vd = parseSizeDims(v.name);
    if (!vd || vd.length !== dims.length) continue;
    const d = vd.reduce((sum, x, i) => sum + Math.abs(x - dims[i]!), 0);
    if (d < distance) {
      variant = v;
      distance = d;
    }
  }
  if (!variant) return null;

  const tiers = variant.priceTiers ?? [];
  const quote = item.qty !== undefined && item.qty_unit ? quotePrice(tiers, item.qty, item.qty_unit) : null;
  return {
    item,
    productId: product.id,
    productName: product.name,
    variantName: variant.name,
    exact: normalizeSize(variant.name) === normalizeSize(item.size),
    quote,
    tier: quote?.kind === 'quote' ? quote.tier : lowestTier(tiers) ?? null,
  };
}
