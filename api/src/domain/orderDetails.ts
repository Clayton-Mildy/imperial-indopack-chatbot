/**
 * The six order details the team needs before it can quote (Nama, Usaha, Model, Ukuran, Jumlah,
 * Desain), read from the facts the bot collected in contact_profiles.profile (mergeOrderFacts). The
 * Perlu Tim queue counts the filled ones and names the missing ones; the conversation panel shows
 * the rows. Pure: the profile is jsonb the model wrote, so every field is read defensively.
 */

import { gsmAfterName } from './gramasi.js';
import { sanitizeItem, type BrandSlug, type OrderItem } from './orderProfile.js';
import { BRAND_SLUGS } from './brands.js';
import { PCS_PER_RIM, type QtyUnit } from './pricing.js';

export const ORDER_DETAIL_KEYS = ['name', 'business_name', 'model', 'size', 'qty', 'design'] as const;
export type OrderDetailKey = (typeof ORDER_DETAIL_KEYS)[number];
export interface OrderDetailRow { key: OrderDetailKey; filled: boolean; value: string | null }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Indonesian digits: 5000 -> '5.000', 2.5 -> '2,5' (at most two decimals, so 1.1 rim is not 550,0000000000001 pcs). */
function idNumber(n: number): string {
  const [int = '', frac] = String(Math.round(n * 100) / 100).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return frac ? `${grouped},${frac}` : grouped;
}

/** 5000 pcs -> '5.000 pcs (10 rim)'; 12 rim -> '12 rim (6.000 pcs)'; 2700 pcs -> '2.700 pcs' (rim only when whole). */
export function formatItemQty(qty: number, unit: QtyUnit): string {
  if (unit === 'rim') return `${idNumber(qty)} rim (${idNumber(qty * PCS_PER_RIM)} pcs)`;
  return qty % PCS_PER_RIM === 0 ? `${idNumber(qty)} pcs (${idNumber(qty / PCS_PER_RIM)} rim)` : `${idNumber(qty)} pcs`;
}

/** 'Box Ivory, cetak full color'; the gsm is added when the product name does not already say it. No product, no model. */
function itemModel(i: OrderItem): string {
  if (!i.product) return '';
  const withGsm = [i.product, gsmAfterName(i.product, i.gsm)].filter(Boolean).join(' ');
  return i.print ? `${withGsm}, cetak ${i.print}` : withGsm;
}

/** A quantity whose unit was never said is the number alone. */
function itemQty(i: OrderItem): string {
  if (i.qty === undefined) return '';
  return i.qty_unit ? formatItemQty(i.qty, i.qty_unit) : idNumber(i.qty);
}

function itemsOf(facts: Record<string, unknown>): OrderItem[] {
  return (Array.isArray(facts.items) ? facts.items : []).filter(isRecord).map(sanitizeItem);
}

/**
 * Always six rows, in ORDER_DETAIL_KEYS order. Several items join with '; '. The design is known
 * from any item's has_design or the order-level one (a design said before any product): any "yes"
 * is 'Ada', otherwise any "no" is 'Belum ada', otherwise it is not filled.
 */
export function orderDetailRows(facts: Record<string, unknown>): OrderDetailRow[] {
  const items = itemsOf(facts);
  const join = (parts: string[]) => parts.filter(Boolean).join('; ');
  const designs = [...items.map((i) => i.has_design), facts.has_design].filter((d): d is boolean => typeof d === 'boolean');
  const values: Record<OrderDetailKey, string> = {
    name: text(facts.name),
    business_name: text(facts.business_name),
    model: join(items.map(itemModel)),
    size: join(items.map((i) => i.size ?? '')),
    qty: join(items.map(itemQty)),
    design: designs.length === 0 ? '' : designs.includes(true) ? 'Ada' : 'Belum ada',
  };
  return ORDER_DETAIL_KEYS.map((key) => ({ key, filled: values[key] !== '', value: values[key] || null }));
}

/**
 * '<model> · <size> · <qty> · desain ada|belum ada desain' per item, unknown parts dropped, items joined ' + '.
 * Takes the stored jsonb array as it is: anything that is not an item is skipped.
 */
export function orderItemsSummary(items: unknown[]): string {
  return items
    .filter(isRecord)
    .map((raw) => {
      const i = sanitizeItem(raw);
      const design = i.has_design === undefined ? '' : i.has_design ? 'desain ada' : 'belum ada desain';
      return [itemModel(i), i.size ?? '', itemQty(i), design].filter(Boolean).join(' · ');
    })
    .filter(Boolean)
    .join(' + ');
}

/**
 * Who the customer is, as the inbox row and the queue item show it: the name the bot collected, else
 * the WhatsApp display name; the business; the brands discussed (known slugs only, in BRAND_SLUGS order).
 */
export function contactHeadline(
  profile: unknown,
  displayName: string | null
): { customerName: string | null; businessName: string | null; brands: BrandSlug[] } {
  const facts = isRecord(profile) ? profile : {};
  const brands = Array.isArray(facts.brands) ? facts.brands : [];
  return {
    customerName: text(facts.name) || text(displayName) || null,
    businessName: text(facts.business_name) || null,
    brands: BRAND_SLUGS.filter((s) => brands.includes(s)),
  };
}

/** The facts as a record, whatever the jsonb holds. */
export function profileFacts(profile: unknown): Record<string, unknown> {
  return isRecord(profile) ? profile : {};
}
