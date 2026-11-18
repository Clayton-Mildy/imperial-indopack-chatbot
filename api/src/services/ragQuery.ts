import { eq, inArray, and, ne } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { products, productVariants, brands, categories, uomTable } from '../db/schema.js';
import { hybridSearchProducts, listProducts, mapUom, mapVariant } from '../repositories/products.js';
import { MAX_CATALOG_RAG_RESULTS, REFERENCE_PHOTOS_MARKER } from '../domain/constants.js';
import { BRAND_NAMES, type BrandSlug } from '../domain/orderProfile.js';
import { brandsInText } from './catalogDelivery.js';
import type { Product } from '../domain/types.js';
import { toPcs, type PriceTier } from '../domain/pricing.js';

// ─── OpenAI embedding helper ─────────────────────────────────────────────────

async function embedQuery(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null; // embeddings not configured yet — fall back to ILIKE only

  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { data: [{ embedding: number[] }] };
    return data.data[0].embedding;
  } catch {
    return null; // non-fatal — degrade gracefully to ILIKE
  }
}

// ─── Indonesian stopwords + common chat words to filter out ──────────────────
// NOTE: Do NOT add size/descriptor words like "besar", "kecil", "tipis", "slim"
// here — they appear directly in product names and are meaningful search terms
// (e.g. "HANDLE BESAR", "ENGSEL TIPIS").
const STOPWORDS = new Set([
  // Question words
  'berapa', 'apa', 'apakah', 'gimana', 'bagaimana', 'kapan', 'siapa', 'kenapa',
  'mengapa', 'dimana', 'mana',
  // Common verbs / connectors
  'ada', 'mau', 'beli', 'bisa', 'boleh', 'tolong', 'mohon', 'ingin', 'minta',
  'butuh', 'perlu',
  'cari', 'tanya', 'kasih', 'lihat', 'cek', 'info',
  // Articles / prepositions
  'yang', 'untuk', 'dari', 'ke', 'di', 'dengan', 'dan', 'atau', 'juga',
  'ini', 'itu', 'nya', 'saya', 'aku', 'kamu', 'mas', 'mbak', 'pak', 'bu',
  // Price / common product nouns that are too generic
  'harga', 'produk', 'barang', 'item', 'stok', 'stock',
  // Meta-query words (about photos, catalogs, availability — not product names)
  'foto', 'gambar', 'picture', 'image', 'katalog', 'catalog', 'brosur',
  // Generic filler words that do NOT appear in product names
  'dong', 'nih', 'deh', 'sih', 'yah', 'dulu', 'sekarang',
  // English stopwords
  'what', 'how', 'is', 'are', 'the', 'a', 'an', 'i', 'want', 'need',
  'price', 'do', 'you', 'have',
]);

interface ParsedQuery {
  keywords: string[];
  /** brands.name to search within (ILIKE), when the message names exactly one brand. */
  brandFilter: string | null;
}

/**
 * The brand a message names, by the words customers use for it (catalogDelivery.brandsInText: "kertas
 * nasi" is Kertas Supreme, "dus" is Imperial Indopack). Null for none, and for both: a message about
 * boxes and paper must search both brands.
 */
export function detectBrand(message: string): BrandSlug | null {
  const named = brandsInText(message);
  return named.length === 1 ? named[0]! : null;
}

function parseQuery(message: string): ParsedQuery {
  // Strip punctuation including + and - which appear in product names but not
  // as meaningful tokens in customer messages.
  const lower = message.toLowerCase().replace(/[?!.,;:+\-]/g, ' ');
  const words = lower.split(/\s+/).filter(Boolean);

  const brand = detectBrand(message);
  const brandFilter = brand ? BRAND_NAMES[brand] : null;

  // Strip common Indonesian possessive/pronoun suffixes before stopword check
  const stripSuffixes = (w: string): string =>
    w.replace(/nya$/, '').replace(/ku$/, '').replace(/mu$/, '').replace(/kan$/, '') || w;

  // Extract meaningful keywords (remove stopwords, short words, numbers-only)
  const keywords = words
    .map(stripSuffixes)
    .filter((w) => {
      if (w.length < 3) return false;
      if (STOPWORDS.has(w)) return false;
      if (/^\d+$/.test(w)) return false;
      return true;
    });

  return { keywords: [...new Set(keywords)], brandFilter };
}

async function fetchCompanionProducts(mainItems: Product[]): Promise<Product[]> {
  // Collect all related_product_ids from main results
  const companionIdSet = new Set<string>();
  const mainIds = new Set(mainItems.map((p) => p.id));

  for (const item of mainItems) {
    const rawIds = item.relatedProductIds;
    // Normalise: JSONB may return a JS array or (in edge cases) a JSON string
    const ids: string[] = Array.isArray(rawIds)
      ? rawIds.map((id: unknown) => String(id))
      : typeof rawIds === 'string'
        ? (JSON.parse(rawIds) as string[]).map(String)
        : [];
    for (const id of ids) {
      if (!mainIds.has(id)) companionIdSet.add(id);
    }
  }

  console.log(`[ragQuery] fetchCompanionProducts: mainItems=${mainItems.length}, companionCandidates=${companionIdSet.size}`);

  if (companionIdSet.size === 0) return [];

  const db = getDb();
  const companionIds = [...companionIdSet].slice(0, 10); // cap at 10 companions

  // Fetch companion product rows with active in-stock variants only
  const companionProductRows = await db
    .select()
    .from(products)
    .where(inArray(products.id, companionIds));

  console.log(`[ragQuery] fetchCompanionProducts: fetched ${companionProductRows.length} companion product rows for ids: ${companionIds.slice(0, 3).join(', ')}...`);

  if (companionProductRows.length === 0) return [];

  const [brandRows, categoryRows, variantRows, uomRows] = await Promise.all([
    db.select().from(brands).where(inArray(brands.id, [...new Set(companionProductRows.map((p) => p.brandId))])),
    (async () => {
      const catIds = [...new Set(companionProductRows.map((p) => p.categoryId).filter((id): id is string => id !== null))];
      return catIds.length > 0 ? db.select().from(categories).where(inArray(categories.id, catIds)) : [];
    })(),
    db.select().from(productVariants).where(
      and(
        inArray(productVariants.productId, companionIds),
        eq(productVariants.isActive, true),
        ne(productVariants.stockStatus, 'no_stock'),
      )
    ).orderBy(productVariants.name),
    db.select().from(uomTable),
  ]);

  const brandMap = new Map(brandRows.map((b) => [b.id, b]));
  const categoryMap = new Map(categoryRows.map((c) => [c.id, c]));
  const uomMap = new Map(uomRows.map((u) => [u.id, mapUom(u)]));
  const variantMap = new Map<string, typeof variantRows>();
  for (const v of variantRows) {
    const arr = variantMap.get(v.productId) ?? [];
    arr.push(v);
    variantMap.set(v.productId, arr);
  }

  // Only include companions that have at least one in-stock active variant
  const filtered = companionProductRows.filter((p) => (variantMap.get(p.id) ?? []).length > 0);
  console.log(`[ragQuery] fetchCompanionProducts: variantRows=${variantRows.length}, companions with active variants=${filtered.length}`);
  return filtered
    .map((p) => {
      const brand = brandMap.get(p.brandId);
      const category = p.categoryId ? categoryMap.get(p.categoryId) : undefined;
      const variants = (variantMap.get(p.id) ?? []).map((v) => mapVariant(v, uomMap));
      return {
        id: p.id,
        brandId: p.brandId,
        categoryId: p.categoryId,
        name: p.name,
        description: p.description,
        fungsi: p.fungsi,
        usp: p.usp,
        kataKunci: p.kataKunci,
        kelengkapan: p.kelengkapan,
        bahan: p.bahan,
        ketebalan: p.ketebalan,
        imageUrl: p.imageUrl,
        tier: (p.tier as Product['tier']) ?? null,
        relatedProductIds: null,
        upsellProductId: null,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
        brand: brand ? { id: brand.id, name: brand.name, description: brand.description, catalogFileUrl: brand.catalogFileUrl, brandType: brand.brandType, createdAt: brand.createdAt.toISOString() } : undefined,
        category: category ? { id: category.id, name: category.name, description: category.description, createdAt: category.createdAt.toISOString() } : null,
        variants,
      } as Product;
    });
}

export async function buildCatalogContext(userMessage: string, extraKeywords?: string[]): Promise<string> {
  const { keywords, brandFilter } = parseQuery(userMessage);
  // Merge Haiku-extracted keywords with RAG keywords (deduplicated)
  const allKeywords = [...new Set([...keywords, ...(extraKeywords ?? []).map((k) => k.toLowerCase())])];

  // Embed the query for semantic search (gracefully skipped if OPENAI_API_KEY not set)
  const queryEmbedding = await embedQuery(userMessage);

  const items = await hybridSearchProducts({
    keywords: allKeywords,
    brandFilter: brandFilter ?? undefined,
    queryEmbedding: queryEmbedding ?? undefined,
    limit: MAX_CATALOG_RAG_RESULTS,
  });

  if (items.length === 0) {
    return 'Tidak ada produk yang relevan ditemukan di katalog.';
  }

  const mainBlock = formatProducts(items);

  // Fetch companion products (related_product_ids, in-stock only)
  let companionBlock = '';
  try {
    const companions = await fetchCompanionProducts(items);
    if (companions.length > 0) {
      companionBlock = '\n--- PRODUK PELENGKAP ---\n' + formatProducts(companions) + '--- AKHIR PRODUK PELENGKAP ---';
    }
  } catch (err) {
    console.error('[ragQuery] fetchCompanionProducts failed:', err);
  }

  return mainBlock + companionBlock;
}

// ─── Full-catalog block (for the full-catalog system prompt + prompt caching) ─
// Not wired into buildCatalogContext — a separate caller assembles the system
// prompt from this directly, so it can sit behind Anthropic's prompt cache
// instead of being rebuilt per-message.
//
// The block and the product list it is rendered from are cached as ONE snapshot: hitung_harga
// prices from the list (getCatalogProducts), so the tiers it quotes are the tiers the model was
// shown, and an invalidation clears both at once.

interface CatalogSnapshot {
  /** Products with at least one active variant - exactly what the block lists. */
  products: Product[];
  block: string;
}

let catalogCache: CatalogSnapshot | null = null;
let catalogCacheBuiltAt = 0;
let catalogCacheInFlight: Promise<CatalogSnapshot> | null = null;
// Bumped on every invalidation: a build that started before an invalidation must not commit
// its (pre-mutation) result, or a dashboard edit racing a cold build stays invisible for the
// full max-age window.
let catalogCacheGeneration = 0;
const CATALOG_CACHE_MAX_AGE_MS = 60 * 60 * 1000; // 60 min — safety net for a reseed without a service restart

export function invalidateCatalogCache(): void {
  catalogCache = null;
  catalogCacheBuiltAt = 0;
  catalogCacheInFlight = null;
  catalogCacheGeneration++;
}

async function getCatalogSnapshot(): Promise<CatalogSnapshot> {
  if (catalogCache !== null && Date.now() - catalogCacheBuiltAt < CATALOG_CACHE_MAX_AGE_MS) {
    return catalogCache;
  }
  if (catalogCacheInFlight) return catalogCacheInFlight;

  const generation = catalogCacheGeneration;
  const build = (async () => {
    const { products: items } = await listProducts({ limit: 0 });
    const withActiveVariant = items.filter((p) => (p.variants ?? []).some((v) => v.isActive));
    const snapshot: CatalogSnapshot = { products: withActiveVariant, block: formatProducts(withActiveVariant) };
    if (generation === catalogCacheGeneration) {
      catalogCache = snapshot;
      catalogCacheBuiltAt = Date.now();
    }
    return snapshot;
  })();
  // Never leave a rejected promise memoized: one transient DB error must cost one message,
  // not every message until a restart (the next call simply retries).
  catalogCacheInFlight = build;
  build.catch(() => { }).finally(() => {
    if (catalogCacheInFlight === build) catalogCacheInFlight = null;
  });

  return build;
}

export async function getFullCatalogBlock(): Promise<string> {
  return (await getCatalogSnapshot()).block;
}

/** The products the full catalog block lists, from the same cached snapshot. Do not mutate. */
export async function getCatalogProducts(): Promise<Product[]> {
  return (await getCatalogSnapshot()).products;
}

export { REFERENCE_PHOTOS_MARKER };

const idNumber = (n: number): string => n.toLocaleString('id-ID');

/** One price tier, in the exact shape the reply price check parses ("Rp 2.000/pcs"). */
export function formatTierLine(t: PriceTier): string {
  const delivery = t.includesDelivery ? 'sudah termasuk ongkir' : 'belum termasuk ongkir';
  const note = t.note ? ` (${t.note})` : '';
  return `  • mulai ${idNumber(t.minQty)} ${t.qtyUnit} (${idNumber(toPcs(t.minQty, t.qtyUnit))} pcs): Rp ${idNumber(t.priceIdr)}/${t.priceUnit}, ${delivery}${note}`;
}

// Exported for tests - pure, so the rendered block can be asserted without a database.
// Each record starts with "Merek: " (productBlocks in aiLayer splits on that boundary).
export function formatProducts(items: Product[]): string {
  const lines: string[] = [
    'KATALOG PRODUK RELEVAN:',
    'Harga per tingkat jumlah. Untuk harga sesuai jumlah pelanggan WAJIB panggil hitung_harga. 1 rim = 500 pcs/lembar.',
    '',
  ];

  for (const product of items) {
    lines.push(`Merek: ${product.brand?.name ?? ''}`);
    if (product.category) lines.push(`Kategori: ${product.category.name}`);
    lines.push(`Produk: ${product.name}${product.description ? ` — ${product.description}` : ''}`);
    if (product.fungsi) lines.push(`Kegunaan: ${product.fungsi}`);
    if (product.bahan) lines.push(`Bahan: ${product.bahan}`);
    if (product.ketebalan) lines.push(`Ketebalan: ${product.ketebalan}`);
    if (product.kelengkapan) lines.push(`Kelengkapan: ${product.kelengkapan}`);
    if (product.usp) lines.push(`Keunggulan: ${product.usp}`);
    // The urls themselves, in order: respond_to_customer's image_urls are copied from this line.
    const photos = product.referenceImageUrls ?? [];
    if (photos.length > 0) lines.push(`${REFERENCE_PHOTOS_MARKER} ${photos.join(' ')}`);

    const variants = (product.variants ?? []).filter((v) => v.isActive);
    if (variants.length === 0) {
      lines.push('  (Produk tidak aktif)');
    } else {
      for (const v of variants) {
        // An out-of-stock variant is listed (customers ask for it) but carries no price lines.
        if (v.stockStatus === 'no_stock') {
          lines.push(`  - Ukuran: ${v.name} [STOK HABIS SEMENTARA]`);
          continue;
        }
        lines.push(`  - Ukuran: ${v.name}`);
        const tiers = v.priceTiers ?? [];
        if (tiers.length === 0) lines.push('  • harga: dihitung tim');
        else for (const t of tiers) lines.push(formatTierLine(t));
        if (v.description) {
          for (const line of v.description.slice(0, 600).split('\n')) {
            if (line.trim()) lines.push(`    ${line}`);
          }
        }
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}
