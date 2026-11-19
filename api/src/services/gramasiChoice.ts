/**
 * Whether an order item still needs its gramasi before the PO form goes (spec 5.6). The router's net
 * under the prompt rule: an item whose size two or more gramasi offer, with none chosen, holds the form
 * back and the customer is asked which; a size only one gramasi offers takes that one.
 *
 * Pure: the caller passes the catalog (getCatalogProducts, the list the bot quotes from).
 */

import type { Product } from '../domain/types.js';
import type { OrderItem } from '../domain/orderProfile.js';
import { gramasiOfSize, gsmAfterName, sameGsm } from '../domain/gramasi.js';
import { nearestCatalogItems } from './nearestCatalog.js';

export type GramasiChoice =
  | { kind: 'chosen'; gsm: string }
  | { kind: 'only'; gsm: string }
  | { kind: 'ask'; options: string[] }
  | { kind: 'none' };

const NONE: GramasiChoice = { kind: 'none' };

/**
 * The product is the one the order panel's nearest match picks, found without the item's gsm (a
 * recorded "tebal" or a gramasi the product does not sell must not lose the product). The size must be
 * one the catalog has exactly - a custom size is the team's to price, so it waits on nothing. Then, of
 * the gramasi that size is sold in: none -> none; one -> only; the item's own -> chosen; else ask.
 * An item with no gsm that names exactly one of them in its product name ('... 300 gsm', written before
 * gramasi were options) has chosen it.
 */
export function gramasiChoice(item: OrderItem, catalog: Product[]): GramasiChoice {
  if (!item.size) return NONE;
  const matches = nearestCatalogItems({ ...item, gsm: undefined }, catalog);
  const product = catalog.find((p) => p.id === matches[0]?.productId);
  if (!product || !matches.some((m) => m.exact)) return NONE;

  const options = gramasiOfSize(product, item.size);
  if (options.length === 0) return NONE;
  if (options.length === 1) return { kind: 'only', gsm: options[0]! };
  const own = item.gsm
    ? options.filter((o) => sameGsm(o, item.gsm))
    : options.filter((o) => gsmAfterName(item.product, o) === ''); // '' = the name already says it
  return own.length === 1 ? { kind: 'chosen', gsm: own[0]! } : { kind: 'ask', options };
}
