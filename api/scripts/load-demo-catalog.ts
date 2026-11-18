/**
 * Loads the DEMO catalog (every product named "... (CONTOH)"), or removes it with --purge.
 * Run: npm run catalog:demo            (load; safe to repeat)
 *      npm run catalog:demo -- --purge (delete only the (CONTOH) products)
 *
 * Env: DATABASE_URL. Prints counts only.
 */
import 'dotenv/config';
import { loadDemoCatalog, purgeDemoCatalog } from '../src/services/demoCatalog.js';

async function main() {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  if (/legacy/i.test(url)) throw new Error('Refusing to touch a database whose URL matches /legacy/i');

  if (process.argv.includes('--purge')) {
    const r = await purgeDemoCatalog();
    console.log(`Purged demo catalog: ${r.products} products, ${r.variants} variants, ${r.tiers} tiers`);
  } else {
    const r = await loadDemoCatalog();
    console.log(`Loaded demo catalog: ${r.productsCreated} products created, ${r.productsUpdated} updated, ${r.variantsCreated} variants created, ${r.variantsUpdated} updated, ${r.skipped} skipped`);
    for (const e of r.errors) console.log(`  row ${e.row}: ${e.reason}`);
    console.log('Go-live stays blocked (catalog_demo) until: npm run catalog:demo -- --purge');
  }
}

// No process.exit on success: the import refreshes embeddings in the background, and the idle
// pool lets the process end by itself once that is done.
main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
