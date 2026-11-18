import { readFile } from 'fs/promises';
import { join } from 'path';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { getClient, isDevMode, agentQuery, logUsageLine, CLAUDE_MODEL } from './claude.js';
import { searchActiveProducts } from '../repositories/products.js';
import type { Product } from '../domain/types.js';
import type { ProductBox } from './visionKeywords.js';

/**
 * Compares a customer's photo with the catalog's own product photos.
 *
 * Until this existed the model only ever saw the customer's photo next to catalog TEXT, so it could
 * tell a box from a paper wrap but not one box model from another - the catalog never says what a
 * product looks like. With product photos uploaded (services/catalogImages.ts) the photo is compared
 * against the pictures of the likeliest products, and the verdict goes into the turn as a note the
 * reply model and the fit judge both read.
 *
 * Product photo first, a variant's photo only when the product has none: the team uploads per product,
 * and variants mostly differ by size, which no photo shows. Products with no photo at all are simply
 * not compared - the old text-only path still covers them, so an empty catalog changes nothing.
 */

// 20, not 10: with many photographed products sharing one word ("BOX ..."), keyword ranking is a weak
// filter, and ten candidates can all be the wrong look-alikes while the right product sits 11th.
// Sonnet holds 20 photos apart; see PHOTO_MATCH_MODEL.
const MAX_CANDIDATES = 20;
// Tokens per image scale with pixels; 512px keeps a twenty-photo comparison small and is plenty to
// see shape, finish and markings.
const REFERENCE_SIDE = 512;
// The comparison runs before the reply is written, so it is on the customer's clock. Past this the
// turn goes ahead without it, exactly as it did before photos existed.
const MATCH_TIMEOUT_MS = 30_000;

export type PhotoCertainty = 'same' | 'similar' | 'none';
/** What the vision step read off the customer's photo, for the comparison. */
export interface PhotoSeen {
  box: ProductBox | null;
  /** Its primary_category, e.g. "box kue". */
  category: string;
}

export interface PhotoMatch {
  certainty: PhotoCertainty;
  product: { name: string; brand: string | null; imageUrl: string } | null;
  compared: string[];
  reason: string;
  /** The words the shortlist was searched with - logged, so a product missing from `compared` can be traced. */
  searched?: string[];
}

/** The photo a product is compared by: its own, else its first variant's that has one. */
export function referenceImageUrl(p: Product): string | null {
  return p.imageUrl || p.variants?.find((v) => v.imageUrl)?.imageUrl || null;
}

const imageCache = new Map<string, string>();

// Waiting for the comparison costs the vision-keyword head start the photo turn otherwise gets, so
// it is only paid once there is something to compare against. Until photos are uploaded, a photo
// turn runs exactly as before. Re-checked every few minutes, so a fresh upload is picked up.
const HAS_PHOTOS_TTL_MS = 5 * 60_000;
let photosKnown: { has: boolean; at: number } | null = null;

async function catalogHasPhotos(): Promise<boolean> {
  if (photosKnown && Date.now() - photosKnown.at < HAS_PHOTOS_TTL_MS) return photosKnown.has;
  const { rows } = await getDb().execute<{ has: boolean }>(sql`
    SELECT EXISTS (SELECT 1 FROM products WHERE coalesce(image_url, '') <> '')
        OR EXISTS (SELECT 1 FROM product_variants WHERE is_active AND coalesce(image_url, '') <> '') AS has`);
  photosKnown = { has: rows[0]?.has === true, at: Date.now() };
  return photosKnown.has;
}

/**
 * The product, filling the frame. Catalog photos are often mostly white space around a small product,
 * which leaves the detail that tells two look-alike boxes apart - a window in the lid, a fold, a
 * printed pattern - a few dozen pixels wide.
 */
export async function framed(raw: Buffer): Promise<Buffer> {
  const base = sharp(raw).rotate().flatten({ background: '#ffffff' });
  let img: Buffer;
  try {
    img = await base.clone().trim({ threshold: 25 }).toBuffer();
  } catch {
    img = await base.clone().toBuffer(); // nothing to trim (a uniform image)
  }
  return sharp(img).resize(REFERENCE_SIDE, REFERENCE_SIDE, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer();
}

// Margin around the box, as a fraction of its size: the vision step's box is approximate, and a
// package cut off at its lid or handle loses the detail that tells it apart.
const BOX_MARGIN = 0.1;

/**
 * The customer's photo cut down to the product the vision step boxed. Photos are often whole phone
 * screenshots (720x1600) of marketplace and TikTok listings; framed() shrinks them to 240x512, leaving
 * the product a ~200px patch among prices, buttons and a video overlay, where colour and shape are
 * misread. framed()'s border trim cannot do this: a screenshot has no uniform border.
 * The whole photo when there is no usable box - none, a speck, or the photo itself.
 */
export async function cropToProduct(
  customer: { base64: string; mimeType: string },
  box: ProductBox | null
): Promise<{ base64: string; mimeType: string }> {
  if (!box) return customer;
  const [l, t, r, b] = box;
  if ((r - l) * (b - t) < 100 || (r - l) * (b - t) > 8100) return customer; // under 1% or over 81% of the photo
  try {
    const raw = await sharp(Buffer.from(customer.base64, 'base64')).rotate().toBuffer({ resolveWithObject: true });
    const { width: W, height: H } = raw.info;
    const mx = ((r - l) / 100) * W * BOX_MARGIN;
    const my = ((b - t) / 100) * H * BOX_MARGIN;
    const left = Math.max(0, Math.floor((l / 100) * W - mx));
    const top = Math.max(0, Math.floor((t / 100) * H - my));
    const right = Math.min(W, Math.ceil((r / 100) * W + mx));
    const bottom = Math.min(H, Math.ceil((b / 100) * H + my));
    const out = await sharp(raw.data).extract({ left, top, width: right - left, height: bottom - top }).jpeg({ quality: 90 }).toBuffer();
    return { base64: out.toString('base64'), mimeType: 'image/jpeg' };
  } catch {
    return customer; // not an image sharp can read - compare() falls back to it as sent
  }
}

async function loadReference(url: string): Promise<string | null> {
  const hit = imageCache.get(url);
  if (hit) return hit;
  try {
    let raw: Buffer;
    if (/^https?:\/\//i.test(url)) {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return null;
      raw = Buffer.from(await res.arrayBuffer());
    } else {
      raw = await readFile(join(process.cwd(), url.replace(/^\/+/, '')));
    }
    const b64 = (await framed(raw)).toString('base64');
    // ponytail: unbounded only in theory - one entry per catalog photo actually compared.
    imageCache.set(url, b64);
    return b64;
  } catch (err) {
    console.warn(`[photoMatch] could not load reference ${url}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

// Chat filler in a photo caption ("yang kaya gini ada ga?"). Each one would otherwise score every
// product whose prose happens to contain it.
const CAPTION_STOPWORDS = new Set([
  'yang', 'kaya', 'kayak', 'gini', 'begini', 'ini', 'itu', 'ada', 'gak', 'nggak', 'ngga', 'tidak',
  'mau', 'cari', 'barang', 'produk', 'kak', 'kakak', 'min', 'admin', 'pak', 'bu', 'bang', 'dong',
  'ya', 'yah', 'nih', 'tuh', 'apa', 'apakah', 'bisa', 'jual', 'punya', 'sama', 'seperti', 'mirip',
  'untuk', 'buat', 'dan', 'atau', 'saya', 'aku', 'tolong', 'gan', 'sis', 'harga', 'berapa',
]);

/** The words the shortlist is searched with: the photo's vision keywords and the caption's own words. */
export function shortlistTerms(keywords: string[], body: string): string[] {
  const words = captionOf(body).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !CAPTION_STOPWORDS.has(w));
  return [...new Set([...keywords, ...words])];
}

/** Likeliest products with a photo, by the photo's vision keywords and the caption. */

export async function pickCandidates(keywords: string[], caption: string): Promise<Product[]> {
  const terms = shortlistTerms(keywords, caption);
  if (terms.length === 0) return [];
  const found = await searchActiveProducts({ keywords: terms, limit: MAX_CANDIDATES, withPhoto: true });
  return found.filter((p) => referenceImageUrl(p));
}

const COMPARE_PROMPT = `Kamu membandingkan FOTO PELANGGAN dengan beberapa FOTO KATALOG produk kemasan (box karton, lunch box, box kue, kertas bungkus, paper bag, dll).

Tentukan apakah barang di foto pelanggan adalah produk yang SAMA dengan salah satu foto katalog. Bandingkan bentuk, bagian-bagiannya (tutup, sekat, jendela, lipatan, tali/pegangan), bahan dan warna kartonnya atau kertasnya, dan jenis cetakannya. Abaikan sudut foto, cahaya, latar belakang, dan logo atau desain pelanggan yang dicetak di atasnya - logo setiap pelanggan berbeda.

- "same": jelas produk yang sama (model yang sama, bukan hanya jenis yang sama).
- "similar": jenis dan bentuknya mirip salah satu foto katalog, tapi belum bisa dipastikan model yang sama.
- "none": tidak ada foto katalog yang cocok, atau foto pelanggan tidak jelas.

Jenis barang yang sama BELUM berarti produk yang sama: dua box berbeda model tetap "similar" atau "none", bukan "same".
Jenis barang yang BERBEDA tidak pernah "similar": kalau barang di foto pelanggan kertas bungkus dan foto katalog yang paling mirip paper bag (atau box kue lawan lunch box, dst.), jawab "none" - semirip apa pun bentuknya.

Nilai dari GAMBARNYA saja - foto katalog sengaja tidak diberi nama produk.

Balas HANYA JSON: {"match": "<huruf FOTO KATALOG yang cocok, atau null>", "certainty": "same" | "similar" | "none", "reason": "<satu kalimat singkat>"}`;

interface Verdict { match: number | null; certainty: PhotoCertainty; reason: string }

/**
 * Catalog photos are lettered, not numbered, and carry no product name. With "FOTO KATALOG 2: <name>"
 * labels a pick came back as the product listed next to the right one, and followed the LABEL when a
 * name and a photo disagreed - so the comparison now sees pictures only, and a letter cannot be
 * miscounted against the customer's own photo.

 */
export function parseVerdict(raw: string, candidates: number): Verdict | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const v = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const certainty = (['same', 'similar', 'none'] as const).find((c) => c === v['certainty']) ?? null;
    if (!certainty) return null;
    const m = typeof v['match'] === 'string' ? v['match'].trim().toUpperCase() : null;
    const n = m && /^[A-Z]$/.test(m) ? m.charCodeAt(0) - 64 : null;
    const match = n !== null && n <= candidates ? n : null;
    // A verdict that names no photo cannot be "same" or "similar" about anything.
    return { match, certainty: match === null ? 'none' : certainty, reason: typeof v['reason'] === 'string' ? v['reason'] : '' };
  } catch {
    return null;
  }
}

export async function compare(
  customer: { base64: string; mimeType: string },
  refs: { product: Product; b64: string }[],
  model?: string
): Promise<Verdict | null> {
  // Framed like the catalog photos, so both sides show the product at the same scale.
  const shown = await framed(Buffer.from(customer.base64, 'base64'))
    .then((b) => ({ data: b.toString('base64'), media_type: 'image/jpeg' as const }))
    .catch(() => ({ data: customer.base64, media_type: customer.mimeType as 'image/jpeg' }));
  const content: ({ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string } })[] = [
    { type: 'text', text: 'FOTO PELANGGAN:' },
    { type: 'image', source: { type: 'base64', ...shown } },
  ];
  refs.forEach((r, i) => {
    content.push({ type: 'text', text: `FOTO KATALOG ${String.fromCharCode(65 + i)}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: r.b64 } });
  });
  content.push({ type: 'text', text: 'Bandingkan dan balas JSON.' });

  let raw: string;
  if (isDevMode()) {
    // Sonnet on the Claude Code route - the subscription reaches it there, though not over the
    // API. Replayed, Haiku called a product "same" as a look-alike missing from the candidates where
    // Sonnet said "none", and picked the right one among 20 less often; same speed (6-9 s). Haiku is
    // the fallback, so a spent Sonnet limit costs the comparison its accuracy, not its answer.
    const preferred = model ?? process.env.PHOTO_MATCH_MODEL ?? 'sonnet';
    const ask = (m?: string) => agentQuery({ systemPrompt: COMPARE_PROMPT, userContent: content, maxTurns: 1, noThinking: true, ...(m && { model: m }) });
    raw = await ask(preferred).catch((err) => {
      console.warn(`[photoMatch] ${preferred} unavailable (${err instanceof Error ? err.message.slice(0, 120) : err}) - comparing on ${CLAUDE_MODEL}`);
      return ask();
    });
  } else {
    const res = await getClient().messages.create({ model: CLAUDE_MODEL, max_tokens: 300, temperature: 0, system: COMPARE_PROMPT, messages: [{ role: 'user', content }] });
    logUsageLine('[photoMatch] usage', { in: res.usage.input_tokens, out: res.usage.output_tokens });
    raw = res.content[0]?.type === 'text' ? res.content[0].text : '';
  }
  const verdict = parseVerdict(raw, refs.length);
  if (!verdict) console.warn(`[photoMatch] unreadable verdict: ${raw.slice(0, 200).replace(/\s+/g, ' ')}`);
  return verdict;
}

// Words in the vision step's item type that say nothing about which type: "kemasan makanan", "box
// cetak", "kertas bungkus makanan" - every product's kata kunci can say "makanan" or "cetak" too.
const GENERIC_ITEM_WORDS = new Set(['set', 'produk', 'barang', 'kemasan', 'packaging', 'makanan', 'cetak', 'custom', 'dan', 'atau', 'untuk']);

/**
 * Whether the pick is the type of item the vision step saw: one word of its item type in the product's
 * name, category or kata kunci (the catalog's own synonym list - not fungsi, whose long use lists would
 * pass almost anything). A photo of an item we do not sell can still come back "similar" or even
 * "same" to a product of roughly the same shape; the comparison prompt alone has not stopped that,
 * while the vision step names the item's type reliably. No item type, no check.
 * ponytail: word overlap, not meaning - a synonym missing from kata kunci drops a right pick. The log
 * line says so; add the word to that product's kata kunci.
 */
export function sharesItemWord(p: Product, itemType: string): boolean {
  const words = itemType.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !GENERIC_ITEM_WORDS.has(w));
  if (words.length === 0) return true;
  const text = [p.name, p.category?.name, p.kataKunci].filter(Boolean).join(' ').toLowerCase();
  return words.some((w) => text.includes(w));
}

/** null = nothing to compare against (no candidate has a photo), or the comparison failed. */
export async function matchCustomerPhoto(
  customer: { base64: string; mimeType: string },
  keywords: string[] | Promise<string[]>,
  caption: string,
  seen: PhotoSeen | null | Promise<PhotoSeen | null> = null
): Promise<PhotoMatch | null> {
  const run = async (): Promise<PhotoMatch | null> => {
    if (!(await catalogHasPhotos())) return null;
    const kw = await keywords;
    const candidates = await pickCandidates(kw, caption);
    const refs = (await Promise.all(candidates.map(async (product) => {
      const b64 = await loadReference(referenceImageUrl(product)!);
      return b64 ? { product, b64 } : null;
    }))).filter((r): r is { product: Product; b64: string } => r !== null);
    if (refs.length === 0) return null;

    const s = await seen;
    const verdict = await compare(await cropToProduct(customer, s?.box ?? null), refs);
    if (!verdict) return null;
    const picked = verdict.match !== null ? refs[verdict.match - 1]!.product : null;
    const chosen = picked && sharesItemWord(picked, s?.category ?? '') ? picked : null;
    return {
      certainty: chosen ? verdict.certainty : 'none',
      product: chosen ? { name: chosen.name, brand: chosen.brand?.name ?? null, imageUrl: referenceImageUrl(chosen)! } : null,
      compared: refs.map((r) => r.product.name),
      // Logged: a "none" the code imposed must not read as the model's own.
      reason: picked && !chosen
        ? `${verdict.reason} [${verdict.certainty} ${picked.name} dibatalkan: "${s!.category}" tidak ada di nama/kategori/kata kunci produk itu]`
        : verdict.reason,
      searched: shortlistTerms(kw, caption),
    };
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Logged: a silent timeout looked exactly like "no candidate has a photo", and hid that no
  // photo turn on the PC got a comparison for three days.
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[photoMatch] no verdict within ${MATCH_TIMEOUT_MS / 1000}s - the reply goes ahead without it`);
      resolve(null);
    }, MATCH_TIMEOUT_MS);
  });
  try {
    return await Promise.race([run(), timeout]);
  } catch (err) {
    console.warn('[photoMatch] comparison failed:', err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The verdict as the reply model reads it, in the customer block. "None" is scoped to the photos
 * actually compared: products without a photo were never looked at, so it must not read as
 * "this is not something we sell".
 */
// Which photo the verdict is for. A chat can hold two: product A earlier, replayed in the history as
// "[Pelanggan mengirim foto: produk kami ... A (foto sama)]", then a photo of B whose correct verdict
// sat here unscoped - and the reply called B "sama seperti A", then asked which one it was.
const LATEST_PHOTO = ' Hasil ini untuk foto yang terlampir di pesan TERAKHIR pelanggan; foto lain di riwayat chat punya hasilnya sendiri - jangan dicampur.';

export function photoMatchNote(m: PhotoMatch | null, scope = LATEST_PHOTO): string | null {
  if (!m) return null;
  const compared = m.compared.join(', ');
  if (m.certainty === 'same' && m.product) {
    return `PERBANDINGAN FOTO: foto pelanggan SAMA dengan foto produk kami ${m.product.name}. Konfirmasikan dengan percaya diri bahwa itu produk kami, lalu lanjutkan seperti biasa.${scope}`;
  }
  if (m.certainty === 'similar' && m.product) {
    return `PERBANDINGAN FOTO: foto pelanggan MIRIP foto produk kami ${m.product.name}, tapi belum pasti model yang sama. Tanyakan ke pelanggan apakah yang dimaksud ${m.product.name}; kalau produk itu punya baris [FOTO REFERENSI TERSEDIA], salin url-nya ke image_urls supaya fotonya ikut terkirim untuk dicocokkan. Jangan menyatakannya pasti sama.${scope}`;
  }
  return `PERBANDINGAN FOTO: foto pelanggan sudah dibandingkan dengan foto produk ${compared} dan TIDAK ada yang sama. Jangan klaim barang di foto adalah salah satu produk itu. Produk lain belum punya foto pembanding - nilai dari data katalog seperti biasa.${scope}`;
}

/** Everything the reply should know about the photo, for the customer block. */
export function photoTurnNote(m: PhotoMatch | null, scope = LATEST_PHOTO): string | null {
  return photoMatchNote(m, scope);
}

/**
 * Photos sent together, answered in one turn (messageRouter): each verdict numbered by its photo - the
 * FOTO 1..N labels aiLayer puts on the images - and scoped once to the latest message.
 */
export function photoBatchNote(photos: { match: PhotoMatch | null }[]): string | null {
  if (photos.length === 1) return photoTurnNote(photos[0]!.match);
  const notes = photos
    .map((ph, i) => {
      const note = photoTurnNote(ph.match, '');
      return note ? `FOTO ${i + 1}: ${note}` : null;
    })
    .filter(Boolean);
  if (notes.length === 0) return null;
  return `${notes.join(' ')} Hasil ini untuk FOTO 1-${photos.length} yang terlampir di pesan TERAKHIR pelanggan, masing-masing sesuai nomornya; foto lain di riwayat chat punya hasilnya sendiri - jangan dicampur.`;
}

/**
 * What a later turn may know about this photo - stored on the message, rendered by
 * aiLayer.historyBody. The verdict when there is one, else the vision keywords.
 */
export function photoHistoryNote(m: PhotoMatch | null, keywords: string[]): string {
  if (m?.product && m.certainty === 'same') return `produk kami ${m.product.name} (foto sama)`;
  const seen = keywords.slice(0, 6).join(', ');
  // A "mirip" is a question to ask, never an answer either way. Unnamed it read as "not carried" and the
  // bot told customers "belum ada di kami" for a product the comparison had found (review 2026-10-13);
  // stated plainly, "mirip produk kami X" on a photo of another item type was SOLD as X. The type rule in
  // COMPARE_PROMPT now stops that verdict upstream, and the history rule ranks the customer's words higher.
  // Since 2026-11-11 a photo that is not a confirmed match goes to the team (messageRouter.photoUnsureReason),
  // so a later turn must not answer it either: no product offered or denied on the strength of this photo.
  // The customer's own words still count - a product they name is answered as usual.
  const unsure = 'belum bisa dipastikan produk kami - tim sedang mengecek foto ini; jangan menawarkan, menyebut, atau menolak produk berdasarkan foto ini. Kalau pelanggan sendiri menyebut nama barangnya, jawab sesuai kata pelanggan';
  if (m?.product && m.certainty === 'similar') return `${unsure} (mirip ${m.product.name}, belum pasti)`;
  return `${unsure}${seen ? `; isi foto: ${seen}` : ''}`;
}

/** A customer photo as text: what its turn found, then the caption (none for the placeholder). */
export function photoLine(body: string, note: string): string {
  const caption = captionOf(body);
  return `[Pelanggan mengirim foto${note ? `: ${note}` : ''}]${caption ? ` ${caption}` : ''}`;
}

/**
 * What the customer wrote with the photo. An uncaptioned photo is stored as the placeholder
 * "[Pelanggan mengirim foto — analisis gambar terlampir]" (messageRouter), which is nobody's words: live
 * 2026-10-25 "pelanggan, mengirim, foto, analisis, gambar, terlampir" were searched as product words.
 */
export function captionOf(body: string): string {
  return body.startsWith('[Pelanggan mengirim foto') ? '' : body;
}
