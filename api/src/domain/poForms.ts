/**
 * The client's two order forms (2026-11-19): "cetak" for a customer who already has a design or logo
 * to print, "plano" for one who does not. Which one a customer gets is decided here, from the order
 * facts (domain/orderProfile.ts), never by the model. The links themselves are settings
 * (appSettings.getPoFormUrls); the customer message is constants.poFormsMessage.
 */
import { sanitizeItem } from './orderProfile.js';

export type PoFormKind = 'cetak' | 'plano';

/** Both forms, in the order they are always listed and sent. */
export const PO_FORM_KINDS = ['cetak', 'plano'] as const satisfies readonly PoFormKind[];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Client rule: "cetak is if have design, plano if don't have design". The design facts are each
 * item's has_design and the order-level has_design (a design said before any product). All of them
 * say there is a design: cetak. All say there is none: plano. They disagree, or none is known: both,
 * so the customer picks.
 */
export function poFormsForOrder(facts: Record<string, unknown>): PoFormKind[] {
  const items = (Array.isArray(facts.items) ? facts.items : []).filter(isRecord).map(sanitizeItem);
  const designs = [...items.map((i) => i.has_design), facts.has_design].filter((d): d is boolean => typeof d === 'boolean');
  if (designs.length > 0 && designs.every((d) => d)) return ['cetak'];
  if (designs.length > 0 && designs.every((d) => !d)) return ['plano'];
  return [...PO_FORM_KINDS];
}
