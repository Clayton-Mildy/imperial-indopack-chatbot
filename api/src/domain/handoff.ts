// Why a conversation was handed to the team - the dashboard's Perlu Tim queue groups by it. Stored on
// conversations.handoff_category with every hand-off (the values are the column's CHECK list, migration
// 0028) and cleared with the reason when the chat leaves the held state.

import type { PriceOutcome } from '../services/priceTool.js';

export const HANDOFF_CATEGORIES = ['harga_custom', 'desain_masuk', 'pesanan_besar', 'minta_orang', 'komplain', 'bukan_pembeli', 'lainnya'] as const;
export type HandoffCategory = (typeof HANDOFF_CATEGORIES)[number];

export const HANDOFF_LABEL: Record<HandoffCategory, string> = {
  harga_custom: 'Harga custom',
  desain_masuk: 'Desain masuk',
  pesanan_besar: 'Pesanan besar',
  minta_orang: 'Minta bicara dengan orang',
  komplain: 'Komplain',
  bukan_pembeli: 'Bukan pembeli',
  lainnya: 'Lainnya',
};

/** What the hand-off turn knew: the router's detectors, the turn's hitung_harga outcomes, a file or photo received. */
export interface HandoffSignals {
  nonSales: boolean;
  complaint: boolean;
  humanRequested: boolean;
  priceOutcomes: PriceOutcome[];
  designReceived: boolean;
}

export const NO_SIGNALS: HandoffSignals = { nonSales: false, complaint: false, humanRequested: false, priceOutcomes: [], designReceived: false };

/**
 * The signals in priority order - not a buyer first, then a complaint, a request for a person, an
 * order above the top price tier, a price the catalog does not have, a design received - and, when
 * none of them fired, the hand-off reason text (the model's own reason, or a fixed one).
 */
export function classifyHandoff(s: HandoffSignals, reason: string): HandoffCategory {
  if (s.nonSales) return 'bukan_pembeli';
  if (s.complaint) return 'komplain';
  if (s.humanRequested) return 'minta_orang';
  if (s.priceOutcomes.includes('above_top_tier')) return 'pesanan_besar';
  if (s.priceOutcomes.includes('not_in_catalog')) return 'harga_custom';
  if (s.designReceived) return 'desain_masuk';
  if (/di luar katalog|tidak ada di katalog|custom/i.test(reason)) return 'harga_custom';
  if (/tingkat teratas|pesanan besar/i.test(reason)) return 'pesanan_besar';
  if (/logo|desain|file/i.test(reason)) return 'desain_masuk';
  if (/bukan pertanyaan produk/i.test(reason)) return 'bukan_pembeli';
  return 'lainnya';
}
