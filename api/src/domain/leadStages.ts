/**
 * leadStages.ts - pure rules for a lead's stage, kind and lost reason. No DB access.
 *
 * The AI reports a stage and evidence; these functions decide whether the report may be applied.
 * Stages only move forward. Won and Lost are terminal here; reopening is a separate path.
 */
import {
  LEAD_KINDS,
  LOST_REASONS,
  type LeadKind,
  type LeadStatus,
  type LostReason,
} from './types.js';

/** Order of the sales funnel. Lost shares Won's rank: neither can advance into the other. */
export const STAGE_RANK: Record<LeadStatus, number> = {
  new: 0,
  contacted: 1,
  quoted: 2,
  won: 3,
  lost: 3,
};

/** True only when `to` is strictly further down the funnel than `from`. Won and Lost never advance. */
export function canAdvance(from: LeadStatus, to: LeadStatus): boolean {
  if (from === 'won' || from === 'lost') return false;
  return STAGE_RANK[to] > STAGE_RANK[from];
}

/** Lowercase, punctuation removed (digits and letters kept), whitespace collapsed. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const MIN_EVIDENCE_CHARS = 4;

/**
 * Returns the first message whose normalised body contains the normalised evidence, or null.
 * Evidence shorter than 4 normalised characters never matches (too short to prove anything).
 * Only the messages passed in are searched; callers pass customer messages only.
 */
export function matchEvidence(
  evidence: string,
  customerMessages: { id: string; body: string }[],
): { id: string; body: string } | null {
  const needle = normalise(evidence);
  if (needle.length < MIN_EVIDENCE_CHARS) return null;
  for (const message of customerMessages) {
    if (normalise(message.body).includes(needle)) return message;
  }
  return null;
}

/** A rupiah figure: "Rp 46.000" or "Rp.5000". The leading word boundary keeps "LRP 8161" out. */
const PRICE_FIGURE_RE = /\bRp\.?\s*\d/i;

export function hasPriceFigure(body: string): boolean {
  return PRICE_FIGURE_RE.test(body);
}

function normaliseEnum(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  return raw.trim().toLowerCase().replace(/[\s-]/g, '_');
}

export function parseLeadKind(raw: unknown): LeadKind | undefined {
  const value = normaliseEnum(raw);
  const match = LEAD_KINDS.find((kind) => kind === value);
  if (match) return match;
  console.warn(`[leadStages] ignoring unknown kind: ${JSON.stringify(raw)}`);
  return undefined;
}

export function parseLostReason(raw: unknown): LostReason | undefined {
  const value = normaliseEnum(raw);
  const match = LOST_REASONS.find((reason) => reason === value);
  if (match) return match;
  console.warn(`[leadStages] ignoring unknown lost reason: ${JSON.stringify(raw)}`);
  return undefined;
}

/** Maps the topic strings returned by escalationHandler's detectNonSalesTopic to a lead kind. */
export function kindFromNonSalesTopic(topic: string): LeadKind {
  switch (topic) {
    case 'Kurir / pengambilan pesanan':
      return 'kurir';
    case 'Lowongan kerja':
      return 'lamaran_kerja';
    case 'Pembayaran / status pesanan':
      return 'status_pesanan';
    case 'Penawaran kerja sama / supplier':
      return 'supplier';
    default:
      return 'lainnya';
  }
}

/**
 * The lead kind for a hand-off the MODEL marked "BUKAN PEMBELI: ..." when no keyword detector named a
 * topic (a courier asking who receives a parcel matched none of them, and the lead pass then filed
 * it as status_pesanan - QA courier). Read from the reason's words; anything else is 'lainnya'.
 */
export function kindFromNonSalesReason(reason: string): LeadKind {
  if (/\b(?:kurir|ojek|driver|pengantar|mengirim\s+paket|antar\s+paket|paket\s+untuk|penerima)\b/i.test(reason)) return 'kurir';
  if (/\b(?:lowongan|lamar(?:an)?|melamar|pelamar|loker)\b/i.test(reason)) return 'lamaran_kerja';
  if (/\b(?:supplier|pemasok|vendor|menawarkan|penawaran|produsen|pabrik)\b/i.test(reason)) return 'supplier';
  return 'lainnya';
}
