/**
 * Which price-list files, if any, this message earns (spec 7.3). Each brand has one price list
 * (brands.catalog_file_url, uploaded in the dashboard). The rule:
 *   - Trigger: the customer asks for a price or the price list (messageRouter: isPriceRequest or a
 *     catalog request, or the model's catalog_url flag) while the profile holds no item with
 *     product, size and quantity yet. Once it does, hitung_harga prices that item instead - unless
 *     the customer asks for the list itself (asksForPriceList: "daftar harga", "pricelist"), which
 *     always gets it.
 *   - Which file: every brand in profile.brands plus every brand the message names (brandsInText),
 *     so both files when both brands are in play. The bare ad text "berapa harga kertas supreme?"
 *     from a customer we know nothing about gets the Kertas Supreme list from its own words.
 *   - Brand unknown: nothing is sent, and the note tells the model to ask what they pack first.
 *   - Repeats: each brand's file goes once per conversation (per contact, until /new), unless the
 *     customer asks for the list itself again (`explicit`).
 *   - When: a request for the list itself goes before the reply. A price question is decided after
 *     it, with this turn's facts (final review M6): "berapa harga kertas supreme 30x30 10 rim" as a
 *     first message used to get the whole list, because the profile was still empty. Before the reply
 *     the model reads a `preview` (what would go, said as going after its reply unless it prices the
 *     item); after it, a quote this turn (`fresh.quoted`) or a priced item in this turn's facts sends
 *     nothing - unless the reply itself says the list is coming (`promised`).
 *
 * One resolver, called by every send site, and its `note` is fed to the model so the reply and
 * the attachments cannot disagree about what was sent.
 */

import { getContactProfile } from '../repositories/contactProfiles.js';
import { listBrands } from '../repositories/products.js';
import { CATALOG_SENT_MARKER } from '../domain/constants.js';
import { BRAND_NAMES, type BrandSlug } from '../domain/orderProfile.js';

export interface CatalogDelivery {
  files: { url: string; filename: string }[];
  /** Appended to the customer block so the model says what actually happened. */
  note: string;
}

const isBrandSlug = (v: unknown): v is BrandSlug => typeof v === 'string' && Object.hasOwn(BRAND_NAMES, v);

const KERTAS_SUPREME_RE = /supreme|kertas\s+(nasi|bungkus)|greaseproof/i;
// Whole words only: a bare "dus" is in "industri" and "produsen", a bare "box" in "inbox".
const IMPERIAL_INDOPACK_RE = /\b(?:box|dus|dos|karton|kardus|kotak)(?:nya)?\b/i;
const LUNCH_BOX_RE = /\blunch ?box\b/i;

/** The brands a message names, by the words customers use for them. */
export function brandsInText(text: string): BrandSlug[] {
  const out: BrandSlug[] = [];
  if (KERTAS_SUPREME_RE.test(text)) out.push('kertas_supreme');
  if (IMPERIAL_INDOPACK_RE.test(text) || LUNCH_BOX_RE.test(text)) out.push('imperial_indopack');
  return out;
}

const PRICE_LIST_RE = /daftar harga|price ?list|pricelist/i;

/** The customer asks for the price list itself, not just a price: it is sent even for a priced item, and again. */
export function asksForPriceList(text: string): boolean {
  return PRICE_LIST_RE.test(text);
}

// A price word, or "berapaan" ("how much is it"). Not a bare "berapa": "berapa lama?", "berapa hari?",
// "minimal berapa?" and "isinya berapa lembar?" are not price questions, and drew an unrequested price
// list (final review M5). "berapa harga ...?" has its price word.
const PRICE_REQUEST_RE = /harga|price|biaya|ongkos|tarif|\bberapa\s*-?\s*an\b/i;

/** A price or price-list question: what earns the price list. */
export function isPriceRequest(text: string): boolean {
  return PRICE_REQUEST_RE.test(text);
}

const present = (v: unknown): boolean =>
  typeof v === 'string' ? v.trim() !== '' : typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * Some item has product, size and qty - enough for hitung_harga to price it, so the whole list is
 * not sent. Profile facts are written by the model, so anything malformed reads as no item.
 */
export function hasPricedItem(items: unknown): boolean {
  return Array.isArray(items) && items.some((it) => {
    if (!it || typeof it !== 'object') return false;
    const i = it as Record<string, unknown>;
    return present(i['product']) && present(i['size']) && present(i['qty']);
  });
}

const slugsIn = (v: unknown): BrandSlug[] => (Array.isArray(v) ? v.filter(isBrandSlug) : []);
const asFacts = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** `${contactId}:${brand}` for every price list sent, until /new (forgetSentPriceLists). */
const sentPriceLists = new Set<string>();

/** /new starts the conversation over, so its price lists may go out again. */
export function forgetSentPriceLists(contactId: string): void {
  for (const slug of Object.keys(BRAND_NAMES)) sentPriceLists.delete(`${contactId}:${slug}`);
}

const NOT_SENT = 'KATALOG: belum ada file yang dikirim - JANGAN katakan katalog sudah dikirim.';
/** The note when nothing could be resolved at all (the resolver failed): nothing went out. */
export const CATALOG_NOT_SENT_NOTE = NOT_SENT;
const UNKNOWN_BRAND = 'Merek belum jelas: tanyakan dulu barang apa yang mau dikemas, JANGAN bilang daftar harga sudah dikirim.';
const PRICED_ITEM = 'Barang, ukuran, dan jumlahnya sudah diketahui, jadi daftar harga tidak dikirim: sebutkan harganya lewat hitung_harga.';

export async function resolveCatalogDelivery(
  contactId: string | null,
  text: string,
  opts: {
    /**
     * The customer asked for the list itself: it goes even for a priced item, and a brand's list
     * already sent goes again. Defaults to asksForPriceList(text); a caller that already sent this
     * message's lists passes false.
     */
    explicit?: boolean;
    /**
     * What THIS turn learned, maybe not saved yet: the model's facts, and whether hitung_harga quoted a
     * price (a quote is a priced item whatever the facts say).
     */
    fresh?: { facts?: Record<string, unknown>; quoted?: boolean };
    /** Before the reply: say what would go, as going after it, and record nothing. */
    preview?: boolean;
    /** The reply told the customer the list is coming: a priced item does not stop it (repeats still do). */
    promised?: boolean;
  } = {}
): Promise<CatalogDelivery> {
  const { explicit = asksForPriceList(text), fresh, preview = false, promised = false } = opts;
  const profile = contactId ? await getContactProfile(contactId) : null;
  const facts = asFacts(profile?.profile);
  const freshFacts = asFacts(fresh?.facts);

  if (!explicit && !promised && (hasPricedItem(facts['items']) || hasPricedItem(freshFacts['items']) || fresh?.quoted)) {
    return { files: [], note: `${NOT_SENT} ${PRICED_ITEM}` };
  }

  const wanted = [...new Set([...slugsIn(facts['brands']), ...slugsIn(freshFacts['brands']), ...brandsInText(text)])];
  if (wanted.length === 0) return { files: [], note: `${NOT_SENT} ${UNKNOWN_BRAND}` };

  const rows = await listBrands();
  const files: CatalogDelivery['files'] = [];
  const sentNow: string[] = [];
  const sentBefore: string[] = [];
  const noFile: string[] = [];
  for (const slug of wanted) {
    const name = BRAND_NAMES[slug];
    const url = rows.find((b) => sameName(b.name, name))?.catalogFileUrl;
    if (!url) {
      noFile.push(name);
      continue;
    }
    const key = `${contactId}:${slug}`;
    if (contactId && !explicit && sentPriceLists.has(key)) {
      sentBefore.push(name);
      continue;
    }
    if (contactId && !preview) sentPriceLists.add(key);
    files.push({ url, filename: `Daftar Harga ${name}.pdf` });
    sentNow.push(name);
  }

  // Nothing has gone yet, and whether it goes is decided by the reply: no sent marker, so a reply
  // claiming "sudah dikirim" is still caught (verifyReplyCatalogClaim).
  const previewNote = `KATALOG: daftar harga ${sentNow.join(', ')} dikirim sistem sesudah balasan ini - kecuali kamu menghitung ` +
    'harga barangnya lewat hitung_harga di giliran ini; kalau begitu daftar harga tidak dikirim, jadi jangan menyebutnya. ' +
    'Jangan bilang daftar harga sudah dikirim.';
  const note = [
    files.length > 0 ? (preview ? previewNote : CATALOG_SENT_MARKER) : NOT_SENT,
    sentNow.length > 0 && !preview ? `Daftar harga ${sentNow.join(', ')} sudah dikirim.` : '',
    sentBefore.length > 0 ? `Daftar harga ${sentBefore.join(', ')} sudah dikirim sebelumnya di chat ini, jadi tidak dikirim ulang.` : '',
    ...noFile.map((name) => `Daftar harga ${name} belum tersedia - JANGAN bilang daftar harga ${name} sudah dikirim; tanyakan barang, ukuran, dan jumlahnya supaya harganya bisa dihitung.`),
  ];
  return { files, note: note.filter(Boolean).join(' ') };
}
