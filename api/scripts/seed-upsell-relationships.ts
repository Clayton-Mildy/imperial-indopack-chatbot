/**
 * seed-upsell-relationships.ts
 * Populates tier, related_product_ids, and upsell_product_id on products
 * based on name pattern matching against the upsell/cross-sell knowledge doc.
 * Idempotent — safe to re-run.
 */

import 'dotenv/config';
import { getDb } from '../src/db/client.js';
import { products } from '../src/db/schema.js';
import { eq, ilike, or } from 'drizzle-orm';

const db = getDb();

// ─── Tier assignment rules ─────────────────────────────────────────────────────
// Match based on product name patterns; order matters (first match wins)
type TierRule = { pattern: RegExp; tier: 'economic' | 'mid' | 'premium' };

const TIER_RULES: TierRule[] = [
  // D-Xplore is the budget line
  { pattern: /d-?xplore/i, tier: 'economic' },
  // Aomori Slim / Aomori tend to be mid/premium
  { pattern: /aomori slim/i, tier: 'premium' },
  { pattern: /aomori/i, tier: 'mid' },
  // Vintage is the mid-range own brand
  { pattern: /vintage/i, tier: 'mid' },
  // Blossom padlocks — economic/mid
  { pattern: /blossom/i, tier: 'mid' },
  // Shind — mid
  { pattern: /shind/i, tier: 'mid' },
];

function assignTier(name: string): 'economic' | 'mid' | 'premium' | null {
  for (const rule of TIER_RULES) {
    if (rule.pattern.test(name)) return rule.tier;
  }
  return null;
}

// ─── Cross-sell pairing matrix ─────────────────────────────────────────────────
// Maps a regex matching the primary product to keyword arrays for companion products.
// Each companion keyword is looked up via ILIKE against products.name.
// excludeCompanionPattern: additionally exclude companions matching this pattern
// (needed when a generic keyword like 'tang' would match unrelated products like 'HANDLE TANGGUNG').
type PairingRule = {
  primaryPattern: RegExp;
  companionKeywords: string[];
  excludeCompanionPattern?: RegExp;
};

const PAIRING_RULES: PairingRule[] = [
  {
    primaryPattern: /handle|handle pintu/i,
    companionKeywords: ['body kunci', 'silinder', 'anak kunci', 'engsel', 'door stopper', 'door closer', 'grendel', 'hak angin', 'sekrup', 'strike plate'],
  },
  {
    primaryPattern: /body kunci/i,
    companionKeywords: ['handle', 'silinder', 'anak kunci', 'strike plate', 'sekrup', 'door closer'],
  },
  {
    primaryPattern: /silinder/i,
    companionKeywords: ['body kunci', 'anak kunci', 'handle'],
  },
  {
    primaryPattern: /engsel/i,
    companionKeywords: ['handle', 'door stopper', 'door closer', 'sekrup', 'grendel'],
  },
  {
    primaryPattern: /door closer/i,
    companionKeywords: ['engsel', 'handle', 'body kunci', 'door stopper'],
  },
  {
    primaryPattern: /grendel/i,
    companionKeywords: ['gembok', 'staple hasp', 'engsel', 'sekrup'],
  },
  {
    primaryPattern: /gembok/i,
    companionKeywords: ['grendel', 'staple hasp', 'rantai', 'door bolt'],
  },
  {
    // 'tang' keyword would match 'HANDLE TANGGUNG' — exclude handle/body products as companions
    primaryPattern: /meteran/i,
    companionKeywords: ['pensil tukang', 'siku aluminium', 'waterpass', 'cutter', 'obeng', 'tang'],
    excludeCompanionPattern: /handle|body kunci|silinder/i,
  },
  {
    // 'tang' keyword would match 'HANDLE TANGGUNG' — exclude handle/body products as companions
    primaryPattern: /obeng/i,
    companionKeywords: ['tang', 'cutter', 'meteran', 'kunci l', 'socket set'],
    excludeCompanionPattern: /handle|body kunci|silinder/i,
  },
  {
    primaryPattern: /tang/i,
    companionKeywords: ['obeng', 'cutter', 'meteran', 'sarung tangan'],
    excludeCompanionPattern: /handle|body kunci|silinder/i,
  },
];

// ─── Upsell pairing (economic → mid → premium) ─────────────────────────────────
// Maps a product name pattern to a list of "better version" keyword patterns.
// First match in the DB wins.
type UpsellRule = { fromPattern: RegExp; toKeywords: string[] };

const UPSELL_RULES: UpsellRule[] = [
  // D-Xplore tools → no direct upsell in own brand (leave null for now)
  // Vintage handle → Aomori equivalent
  {
    fromPattern: /handle.*vintage/i,
    toKeywords: ['handle', 'aomori'],
  },
  // Vintage engsel → Aomori
  {
    fromPattern: /engsel.*vintage/i,
    toKeywords: ['engsel', 'aomori'],
  },
  // Vintage grendel → Aomori
  {
    fromPattern: /grendel.*vintage/i,
    toKeywords: ['grendel', 'aomori'],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function findProductIdByKeywords(keywords: string[]): Promise<string | null> {
  if (keywords.length === 0) return null;
  const conditions = keywords.map((kw) => ilike(products.name, `%${kw}%`));
  // Order before limiting: without it Postgres returns whichever row it reaches
  // first, so the same catalog reseeded twice picks different upsell targets.
  const rows = await db
    .select({ id: products.id })
    .from(products)
    .where(or(...conditions))
    .orderBy(products.name)
    .limit(1);
  return rows[0]?.id ?? null;
}

// excludePatterns filters out unwanted companion candidates.
// Primary use cases:
//   - primaryPattern: exclude combo products (e.g. "HANDLE BESAR + BODY KUNCI") from companions of handle
//   - excludeCompanionPattern: exclude unrelated product types (e.g. 'tang' keyword matches 'HANDLE TANGGUNG')
async function findProductIdsByKeyword(keyword: string, excludePatterns?: RegExp[]): Promise<string[]> {
  // Ordered so related_product_ids comes out identical on every reseed — otherwise
  // the same catalog rewrites the array in a different order each run.
  const rows = await db
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(ilike(products.name, `%${keyword}%`))
    .orderBy(products.name);
  if (!excludePatterns || excludePatterns.length === 0) return rows.map((r) => r.id);
  return rows
    .filter((r) => !excludePatterns.some((pat) => pat.test(r.name)))
    .map((r) => r.id);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const allProducts = await db.select({ id: products.id, name: products.name, kataKunci: products.kataKunci }).from(products);
  console.log(`Found ${allProducts.length} products to process.`);

  let tierUpdated = 0;
  let relatedUpdated = 0;
  let upsellUpdated = 0;

  for (const product of allProducts) {
    const updates: {
      tier?: string | null;
      relatedProductIds?: string[] | null;
      upsellProductId?: string | null;
    } = {};

    // Assign tier
    const tier = assignTier(product.name);
    if (tier) {
      updates.tier = tier;
    }

    // Assign related_product_ids from cross-sell pairing
    // Also check kata_kunci so Blossom gembok products (named BC9030 etc.) are caught
    for (const rule of PAIRING_RULES) {
      const nameMatch = rule.primaryPattern.test(product.name);
      const kwMatch = !!product.kataKunci && rule.primaryPattern.test(product.kataKunci);
      if (nameMatch || kwMatch) {
        const relatedIds: string[] = [];
        for (const kw of rule.companionKeywords) {
          // Exclude: combo products matching primaryPattern + any extra exclusion for generic keywords
          const excludePatterns: RegExp[] = [rule.primaryPattern];
          if (rule.excludeCompanionPattern) excludePatterns.push(rule.excludeCompanionPattern);
          const ids = await findProductIdsByKeyword(kw, excludePatterns);
          for (const id of ids) {
            if (id !== product.id && !relatedIds.includes(id)) {
              relatedIds.push(id);
            }
          }
        }
        if (relatedIds.length > 0) {
          updates.relatedProductIds = relatedIds;
        }
        break; // use first matching pairing rule only
      }
    }

    // Assign upsell_product_id
    for (const rule of UPSELL_RULES) {
      if (rule.fromPattern.test(product.name)) {
        const upsellId = await findProductIdByKeywords(rule.toKeywords);
        if (upsellId && upsellId !== product.id) {
          updates.upsellProductId = upsellId;
        }
        break;
      }
    }

    if (Object.keys(updates).length > 0) {
      await db.update(products).set(updates).where(eq(products.id, product.id));
      if (updates.tier) tierUpdated++;
      if (updates.relatedProductIds) relatedUpdated++;
      if (updates.upsellProductId) upsellUpdated++;
      console.log(`  Updated "${product.name}":`, Object.keys(updates).join(', '));
    }
  }

  console.log(`\nDone. tier=${tierUpdated}, related=${relatedUpdated}, upsell=${upsellUpdated}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
