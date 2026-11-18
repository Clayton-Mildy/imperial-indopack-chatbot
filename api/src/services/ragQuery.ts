import { eq, inArray, and, ne } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { products, productVariants, brands, categories, uomTable } from '../db/schema.js';
import { hybridSearchProducts, listProducts, mapUom, mapVariant } from '../repositories/products.js';
import { MAX_CATALOG_RAG_RESULTS, LEGACY_BRANDS } from '../domain/constants.js';
import type { Product } from '../domain/types.js';

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

// ─── Brand name map for detection ────────────────────────────────────────────
// IMPORTANT: longer/more-specific aliases must come FIRST so they take priority
// over shorter aliases that are substrings (e.g. "aomori slim" before "aomori",
// "d-xplore" before "explore"). "slim" is intentionally removed — it appears in
// product names generically (e.g. "HANDLE PINTU SLIM") and would cause false
// brand matches.
const BRAND_ALIASES: [string, string][] = [
  ['aomori slim', 'Aomori Slim'],
  ['aomori',      'Aomori'],
  ['blossom',     'Blossom'],
  ['vintage',     'Vintage'],
  ['d-xplore',    'D-Xplore'],
  ['dxplore',     'D-Xplore'],
  ['dxp',         'D-Xplore'],
  ['shind',       'Shind'],
];

interface ParsedQuery {
  keywords: string[];
  brandFilter: string | null;
}

/** The brand a message names, or null. Exported so the catalog-PDF resolver reuses this table
 *  instead of keeping a second, drifting copy of the aliases. */
export function detectBrand(message: string): string | null {
  return parseQuery(message).brandFilter;
}

function parseQuery(message: string): ParsedQuery {
  // Strip punctuation including + and - which appear in product names but not
  // as meaningful tokens in customer messages.
  const lower = message.toLowerCase().replace(/[?!.,;:+\-]/g, ' ');
  const words = lower.split(/\s+/).filter(Boolean);

  // Detect brand — BRAND_ALIASES is ordered longest/most-specific first so the
  // first match wins. The LEGACY_BRANDS fallback only runs if no alias matched,
  // preventing a shorter official name from overriding a more-specific alias match.
  let brandFilter: string | null = null;
  const text = lower.replace(/\s+/g, ' ');
  for (const [alias, brand] of BRAND_ALIASES) {
    if (text.includes(alias)) {
      brandFilter = brand;
      break;
    }
  }
  if (brandFilter === null) {
    for (const brand of LEGACY_BRANDS) {
      if (text.includes(brand.toLowerCase())) {
        brandFilter = brand;
        break;
      }
    }
  }

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

let catalogCacheBlock: string | null = null;
let catalogCacheBuiltAt = 0;
let catalogCacheInFlight: Promise<string> | null = null;
// Bumped on every invalidation: a build that started before an invalidation must not commit
// its (pre-mutation) result, or a dashboard edit racing a cold build stays invisible for the
// full max-age window.
let catalogCacheGeneration = 0;
const CATALOG_CACHE_MAX_AGE_MS = 60 * 60 * 1000; // 60 min — safety net for a reseed without a service restart

export function invalidateCatalogCache(): void {
  catalogCacheBlock = null;
  catalogCacheBuiltAt = 0;
  catalogCacheInFlight = null;
  catalogCacheGeneration++;
}

export async function getFullCatalogBlock(): Promise<string> {
  if (catalogCacheBlock !== null && Date.now() - catalogCacheBuiltAt < CATALOG_CACHE_MAX_AGE_MS) {
    return catalogCacheBlock;
  }
  if (catalogCacheInFlight) return catalogCacheInFlight;

  const generation = catalogCacheGeneration;
  const build = (async () => {
    const { products: items } = await listProducts({ limit: 0 });
    const withActiveVariant = items.filter((p) => (p.variants ?? []).some((v) => v.isActive));
    const block = formatProducts(withActiveVariant);
    if (generation === catalogCacheGeneration) {
      catalogCacheBlock = block;
      catalogCacheBuiltAt = Date.now();
    }
    return block;
  })();
  // Never leave a rejected promise memoized: one transient DB error must cost one message,
  // not every message until a restart (the next call simply retries).
  catalogCacheInFlight = build;
  build.catch(() => { }).finally(() => {
    if (catalogCacheInFlight === build) catalogCacheInFlight = null;
  });

  return build;
}

function formatPrice(price: number | null | undefined): string {
  if (price == null) return 'hubungi kami';
  return `Rp ${price.toLocaleString('id-ID')}`;
}

// Exported for tests/catalog-claims.test.ts — pure, so the rendered block can be asserted
// without a database.
export function formatProducts(items: Product[]): string {
  // One line, once. The policy for WHICH price applies to whom lives in the "Kebijakan Harga"
  // prompt section — restating it here would give it two homes that drift apart.
  const lines: string[] = [
    'KATALOG PRODUK RELEVAN:',
    'Tiap varian mencantumkan harga PRICELIST (reseller & pembelian proyek, berlaku per kelipatan penuh satuan yang tertera) lalu MP (pengguna akhir, dan untuk sisa satuan yang tidak genap). Pilih sesuai Kebijakan Harga; jangan pernah menghitung sendiri.',
    '',
  ];

  for (const product of items) {
    const brand = product.brand;
    const brandName = brand?.name ?? '';
    const brandTypeLabel = brand?.brandType === 'distributed' ? ' [Merek Distribusi]' : '';
    const brandHint = brand?.description
      ? ' — ' + brand.description.split(/[.—]/)[0].trim()
      : '';
    lines.push(`Merek: ${brandName}${brandTypeLabel}${brandHint}`);

    // Name only, never categories.description. That description is the one value in this block
    // that traces to no Excel cell (hand-written in seed-categories.ts, editable from the
    // dashboard), and the model believes it over the product's own Fungsi when they disagree —
    // a stale "Door Pull ... termasuk pintu kaca" row is how a wood-only DOORPULL got
    // recommended for a frameless glass door. Labelling it a hint was not enough; it is not
    // shown at all. It still earns its keep as an ILIKE signal in searchActiveProducts, which
    // is its real job: finding candidates, not proving they fit.
    if (product.category) {
      lines.push(`Kategori (petunjuk pencarian): ${product.category.name}`);
    }

    lines.push(`Produk: ${product.name}${product.description ? ` — ${product.description}` : ''}`);

    // Product-level knowledge fields, every value traceable to an Excel cell. Tagged explicitly
    // because they sit beside hand-written prose (the category hint above, the playbook in the
    // system prompt) that can contradict them — the prompt rule makes these win.
    const facts: string[] = [];
    if (product.fungsi) facts.push(`Fungsi: ${product.fungsi}`);
    if (product.bahan) facts.push(`Bahan: ${product.bahan}`);
    if (product.ketebalan) facts.push(`Ketebalan: ${product.ketebalan}`);
    if (product.kelengkapan) facts.push(`Kelengkapan: ${product.kelengkapan}`);
    if (facts.length > 0) {
      lines.push('[DATA KATALOG RESMI - otoritatif untuk kecocokan]');
      lines.push(...facts);
    }
    if (product.usp) lines.push(`Keunggulan: ${product.usp}`);

    const variants = (product.variants ?? []).filter((v) => v.isActive);

    if (variants.length === 0) {
      lines.push('  (Produk tidak aktif)');
    } else {
      lines.push('Varian:');
      for (const v of variants) {
        const uomPrice = v.uomPrice?.name ?? '';
        const uomCtn = v.uomCtn?.name ?? '';
        // Spelled out, not "CTN: 30 Lsn": the Run 2 replay of C-04 read that as the total for "3 karton"
        // (3 karton = 30 Lsn x Rp 68.500) twice - a wrong total no price check can catch, being an
        // honest multiple of a catalog price.
        const ctn = v.isiCtn != null ? ` | 1 karton = ${v.isiCtn}${uomCtn ? ' ' + uomCtn : ''}` : '';
        const uomBox = v.uomBox?.name ?? '';
        const minOrder = v.minOrderQty != null
          ? ` [MIN ORDER: ${v.minOrderQty} ${v.uomMinOrder?.name ?? uomPrice}]`
          : v.isiBox != null
          ? ` [MIN ORDER: ${v.isiBox}${uomBox ? ' ' + uomBox : ''}]`
          : '';
        const stockNote = v.stockStatus === 'price_rise' ? ' [HARGA NAIK ⬆]'
          : v.stockStatus === 'price_drop' ? ' [HARGA TURUN ⬇]'
          : '';
        // MP is the stored marketplace price, not a markup this code applies: the vendor rounds
        // it up to the nearest 500 and divides by 12 on lusin-priced rows, so it carries its own
        // UOM ("Rp 46.000/Lsn | MP: Rp 5.500/Pcs" is one variant).
        //
        // A variant with no MP renders "tanya tim" and no digits, which is what makes the
        // hand-off to the team deterministic: a figure the model invents for it is absent from
        // this block, so verifyReplyPrices rejects it. That used to be a brand allow-list; it is
        // now simply the absence of data, which is the same guarantee without the list.
        const uomSuffix = uomPrice ? '/' + uomPrice : '';
        const mpUomSuffix = v.mpUom?.name ? '/' + v.mpUom.name : uomSuffix;
        const mpPart = v.mpPriceIdr != null
          ? ` | MP: ${formatPrice(v.mpPriceIdr)}${mpUomSuffix}`
          : ' | MP: tanya tim';
        // An out-of-stock variant is listed - customers ask for it by name, and "yang 30mm lagi
        // kosong" is the honest answer - but with no price at all. With both prices on its line the
        // model kept OFFERING it: the Run 2 replays of "gembok kuningan 30mm ready?" and "grendel
        // aluminium vintage" quoted out-of-stock sizes in every draft, repairs included, until the
        // turn was handed to the team (BC9000 has 9 of 11 variants out of stock). What is not in the
        // block cannot be quoted, and a figure made up for it fails verifyReplyPrices.
        if (v.stockStatus === 'no_stock') {
          lines.push(`  - ${v.name} [STOK HABIS SEMENTARA]`);
        } else {
          lines.push(`  - ${v.name}${stockNote}: ${formatPrice(v.priceIdr)}${uomSuffix}${mpPart}${ctn}${minOrder}`);
        }
        if (v.description) {
          const truncated = v.description.length > 600
            ? v.description.slice(0, 600) + '...'
            : v.description;
          for (const line of truncated.split('\n')) {
            if (line.trim()) lines.push(`    ${line}`);
          }
        }
        if (v.imageUrl) lines.push(`    [FOTO TERSEDIA: ${v.imageUrl}]`);
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}
