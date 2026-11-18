/**
 * Which catalog files, if any, this message earns.
 *
 * Two kinds, two rules (client, 2026-10-16):
 *   - The company catalogue (KATALOG LEGACY 2026, CATALOG_FILE_URL): photos and specs for every brand,
 *     NO prices. Anyone who asks gets it - end users and unknown buyers included. Before it existed
 *     end users got no file at all, and the team read that as "AI-nya belum berhasil kirim katalog".
 *   - The six brand price lists (brands.catalog_file_url, "DAFTAR HARGA <merek>") print PRICELIST
 *     figures - the reseller number. Only a CONFIRMED reseller or project buyer gets them: the same
 *     point at which the chat may quote pricelist (Kebijakan Harga's store-identity gate). Before,
 *     "dijual lagi, minta price list vintage" got the PDF while the chat still withheld the prices.
 *
 * One resolver, called by every send site, and its `note` is fed to the model so the reply and
 * the attachments cannot disagree about what was sent.
 */

import { getContactProfile } from '../repositories/contactProfiles.js';
import { listBrands } from '../repositories/products.js';
import { detectBrand } from './ragQuery.js';
import { CATALOG_FILE_URL, CATALOG_SENT_MARKER, END_USER_CATALOG_URL } from '../domain/constants.js';

export interface CatalogDelivery {
  files: { url: string; filename: string }[];
  /** Appended to the customer block so the model says what actually happened. */
  note: string;
}

/** "semua brand", "all", "semuanya" - the one case where six documents is the right answer. */
const ALL_BRANDS_RE = /\b(semua|semuanya|seluruh|all)\b/i;
/** Asked for the price list by name, as opposed to "the catalog". */
const PRICE_LIST_RE = /daftar harga|price ?list|pricelist/i;
const CATALOGUE_RE = /katalog|catalog|brosur|daftar produk|product list/i;
/** A model-flagged request (no keyword) does not resend the 35 MB catalogue within this window. */
const CATALOGUE_RESEND_MS = 6 * 60 * 60_000;
const catalogueSentAt = new Map<string, number>();

export function companyCatalogue(): { url: string; filename: string } | null {
  return /^https?:\/\//i.test(CATALOG_FILE_URL) ? { url: CATALOG_FILE_URL, filename: 'Katalog Legacy.pdf' } : null;
}

const filled = (v: unknown): boolean => (typeof v === 'string' ? v.trim() !== '' : v != null && v !== false);

/**
 * A buyer the price lists may go to: a reseller whose store is known (name + city or address), or a
 * freelance/online seller who has said so; a project buyer with a company or project named. The
 * fields are the ones respond_to_customer's profile_update records (RESPOND_FIELD_DESC).
 */
export function priceListConfirmed(customerType: string | null, facts: Record<string, unknown>): boolean {
  if (customerType === 'reseller') {
    const store = filled(facts['business_name']) && (filled(facts['city']) || filled(facts['store_address']));
    const noStore = /freelance|online|marketplace|belum punya toko|tidak punya toko/i.test(String(facts['business_type'] ?? ''));
    return store || noStore;
  }
  if (customerType === 'project') return filled(facts['company_name']) || filled(facts['project_location']);
  return false;
}

export async function resolveCatalogDelivery(
  contactId: string | null,
  text: string,
  opts: {
    /** The message itself asked (keyword path). False when the model flagged a request the keywords missed. */
    explicit?: boolean;
    /** What the customer said in THIS message, not saved to the profile yet (the model-flagged path runs after the reply). */
    fresh?: { customerType?: string | null; facts?: Record<string, unknown> };
  } = {}
): Promise<CatalogDelivery> {
  const { explicit = true, fresh } = opts;
  const profile = contactId ? await getContactProfile(contactId) : null;
  const customerType = fresh?.customerType ?? profile?.customerType ?? null;
  const facts = { ...((profile?.profile as Record<string, unknown> | undefined) ?? {}), ...(fresh?.facts ?? {}) };
  const confirmed = priceListConfirmed(customerType, facts);

  // Price lists: a confirmed buyer, and a brand named (or "semua").
  const brands = confirmed ? (await listBrands()).filter((b) => b.catalogFileUrl) : [];
  const brandName = detectBrand(text);
  const priceLists = ALL_BRANDS_RE.test(text)
    ? brands
    : brands.filter((b) => b.name === brandName);

  // The catalogue: everyone, except a confirmed buyer who asked for a price list by name and got it.
  const catalogue = companyCatalogue();
  const onlyPriceList = priceLists.length > 0 && PRICE_LIST_RE.test(text) && !CATALOGUE_RE.test(text);
  const recentlySent = !explicit && !!contactId && Date.now() - (catalogueSentAt.get(contactId) ?? 0) < CATALOGUE_RESEND_MS;
  const sendCatalogue = !!catalogue && !onlyPriceList && !recentlySent;
  if (sendCatalogue && contactId) catalogueSentAt.set(contactId, Date.now());

  const files = [
    ...(sendCatalogue ? [catalogue!] : []),
    ...priceLists.map((b) => ({ url: b.catalogFileUrl!, filename: `Price List ${b.name}.pdf` })),
  ];

  const sent: string[] = [];
  if (sendCatalogue) sent.push('Katalog produk Legacy (foto dan spesifikasi, tanpa harga) sudah dikirim.');
  if (priceLists.length) sent.push(`Daftar harga ${priceLists.map((b) => b.name).join(', ')} sudah dikirim.`);

  let next: string;
  if (customerType === null) {
    next = 'Tipe pembeli belum diketahui: tanyakan dulu sesuai Rules. JANGAN menyebut price list atau daftar harga.';
  } else if (customerType === 'end_user') {
    // Owner's call (2026-09-24): end users see their prices at the store. And no reason at all - told
    // the price list "is not for end users", the model told the customer exactly that (UAT F-15).
    next = `JANGAN menyebut price list, reseller, atau tipe harga apa pun, dan JANGAN menjelaskan alasannya. Sampaikan dengan hangat bahwa produk beserta harganya juga bisa dilihat di ${END_USER_CATALOG_URL}, lalu tawarkan untuk membantu memilihkan langsung di chat ini.`;
  } else if (!confirmed) {
    next = 'Daftar harga per merek BELUM dikirim - JANGAN katakan daftar harga atau price list sudah dikirim. Daftar harga baru dikirim setelah identitas sesuai Kebijakan Harga lengkap (reseller: nama toko, kota/lokasi, dan alamat - atau, kalau freelance, produk yang biasa dijual; proyek: nama perusahaan atau proyeknya): tanyakan yang belum ada, dan catat jawabannya di profile_update.';
  } else if (brands.length === 0) {
    next = 'Belum ada file daftar harga per merek. JANGAN katakan daftar harga sudah dikirim.';
  } else if (priceLists.length === 0) {
    next = `Daftar harga per merek belum dikirim karena merek belum disebut: tanyakan merek mana (${brands.map((b) => b.name).join(', ')}), dan sampaikan boleh minta semuanya sekaligus.`;
  } else {
    next = '';
  }

  const head = files.length > 0 ? CATALOG_SENT_MARKER : 'KATALOG: belum ada file yang dikirim - JANGAN katakan katalog sudah dikirim.';
  return { files, note: [head, ...sent, next].filter(Boolean).join(' ') };
}
