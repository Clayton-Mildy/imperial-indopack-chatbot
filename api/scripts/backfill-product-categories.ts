/**
 * backfill-product-categories.ts
 * One-time (re-runnable) backfill: assigns products.category_id by keyword-matching
 * each product against the *existing* categories table (see scripts/lib/categorize-product.ts).
 * Never creates new categories — only matches to what KC already curated.
 *
 * Usage:
 *   npx tsx scripts/backfill-product-categories.ts              # live run
 *   npx tsx scripts/backfill-product-categories.ts --dry-run    # print only, no writes
 */

import 'dotenv/config';
import { getDb } from '../src/db/client.js';
import { categories, products } from '../src/db/schema.js';
import { eq, isNull, sql } from 'drizzle-orm';
import { categorizeProduct } from './lib/categorize-product.js';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const db = getDb();

  const allCategories = await db.select().from(categories);
  const categoryIdByName = new Map(allCategories.map((c) => [c.name.toLowerCase(), c.id]));

  const allProducts = await db
    .select({
      id: products.id,
      name: products.name,
      fungsi: products.fungsi,
      kataKunci: products.kataKunci,
      categoryId: products.categoryId,
    })
    .from(products);

  const updates: { id: string; name: string; categoryId: string; categoryName: string }[] = [];
  const unmatched: string[] = [];
  const unknownCategoryNames = new Set<string>();

  for (const p of allProducts) {
    const categoryName = categorizeProduct(p);
    if (!categoryName) {
      unmatched.push(p.name);
      continue;
    }
    const categoryId = categoryIdByName.get(categoryName.toLowerCase());
    if (!categoryId) {
      unknownCategoryNames.add(categoryName);
      continue;
    }
    if (p.categoryId !== categoryId) {
      updates.push({ id: p.id, name: p.name, categoryId, categoryName });
    }
  }

  if (unknownCategoryNames.size > 0) {
    console.error(
      `\n❌ Rule table references categories that don't exist in the DB: ${[...unknownCategoryNames].join(', ')}`
    );
    process.exit(1);
  }

  console.log(`\nProducts: ${allProducts.length}`);
  console.log(`Already correctly categorized: ${allProducts.length - updates.length - unmatched.length}`);
  console.log(`To update: ${updates.length}`);
  console.log(`Unmatched (no rule fires — legitimate exception): ${unmatched.length}`);
  if (unmatched.length > 0) {
    for (const n of unmatched) console.log(`  - ${n}`);
  }

  const byCategory = new Map<string, number>();
  for (const u of updates) byCategory.set(u.categoryName, (byCategory.get(u.categoryName) ?? 0) + 1);
  console.log(`\nUpdates by category:`);
  for (const [name, count] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name}: ${count}`);
  }

  if (DRY_RUN) {
    console.log('\n=== DRY RUN — no DB writes ===');
    return;
  }

  for (const u of updates) {
    await db.update(products).set({ categoryId: u.categoryId }).where(eq(products.id, u.id));
  }

  const [{ count: stillNull }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(products)
    .where(isNull(products.categoryId));
  console.log(`\n✅ Backfill complete. Products with NULL category_id: ${stillNull} (expected: ${unmatched.length}).`);
}

main().catch((err) => {
  console.error('backfill-product-categories failed:', err);
  process.exit(1);
});
