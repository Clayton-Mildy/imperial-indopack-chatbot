/**
 * Creates, migrates, resets and seeds the QA database (imperial_indopack_qa).
 * Run: npm run qa:setup
 */
import { spawnSync } from 'child_process';
import { join } from 'path';
import { Pool } from 'pg';
import { applyQaEnv, PO_FORM_QA_URLS, requireQaDatabaseUrl } from './env.js';

applyQaEnv();
const url = requireQaDatabaseUrl();
const dbName = new URL(url).pathname.slice(1);

// 1. Create the database if missing (connect to the server's maintenance database).
{
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const pool = new Pool({ connectionString: admin.toString() });
  try {
    const found = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (found.rowCount === 0) {
      await pool.query(`CREATE DATABASE "${dbName.replace(/"/g, '')}"`);
      console.log('created database');
    }
  } finally {
    await pool.end();
  }
}

const { getDb } = await import('../../src/db/client.js');
const { sql } = await import('drizzle-orm');
const { migrate } = await import('drizzle-orm/node-postgres/migrator');

// 2. Migrate.
await migrate(getDb(), { migrationsFolder: join(process.cwd(), 'src', 'db', 'migrations') });

// 3. Reset the conversational tables and the catalog.
const db = getDb();
await db.execute(sql`TRUNCATE contacts, contact_profiles, conversations, messages, leads, lead_events, lead_orders, conversation_reads, catalog_audit RESTART IDENTITY CASCADE`);
await db.execute(sql`DELETE FROM products`);
await db.execute(sql`UPDATE brands SET catalog_file_url = NULL, catalog_file_name = NULL, catalog_file_uploaded_at = NULL`);

// 4. seed-local (admin, API key, capture phone number), against the same database.
const tsx = join(process.cwd(), 'node_modules', '.bin', 'tsx');
const run = (script: string, args: string[] = []) => {
  const r = spawnSync(tsx, [script, ...args], { stdio: 'inherit', env: process.env });
  if (r.status !== 0) { console.error(`${script} failed`); process.exit(1); }
};
run('scripts/seed-local.ts');

// 5. Fixture catalog, price lists, reference photos, PO forms.
const { buildFixtureWorkbook, writeFixtureFiles, PRICE_LIST_FILES } = await import('./fixtures.js');
const { importCatalogFromXlsx } = await import('../../src/services/catalogImport.js');
const { setBrandPriceList, listProducts } = await import('../../src/repositories/products.js');
const { addReferenceImage } = await import('../../src/repositories/referenceImages.js');
const { setPoFormUrl, patchBotSettings } = await import('../../src/repositories/appSettings.js');

const files = await writeFixtureFiles();
const imp = await importCatalogFromXlsx(await buildFixtureWorkbook(), { fileName: 'qa-fixture.xlsx' });
if (imp.errors.length > 0) { console.error('fixture import errors', imp.errors); process.exit(1); }
for (const slug of ['kertas_supreme', 'imperial_indopack'] as const) {
  await setBrandPriceList(slug, { url: files.priceListUrls[slug], fileName: PRICE_LIST_FILES[slug].name });
}
const { products } = await listProducts({ limit: 0 });
const supreme64 = products.find((p) => p.name === 'Kertas Supreme cetak 1 warna');
if (!supreme64) { console.error('fixture product missing'); process.exit(1); }
for (const u of files.referenceUrls) await addReferenceImage(supreme64.id, u);
await setPoFormUrl('cetak', PO_FORM_QA_URLS.cetak);
await setPoFormUrl('plano', PO_FORM_QA_URLS.plano);
await patchBotSettings({});

const sizes = products.reduce((n, p) => n + (p.variants?.length ?? 0), 0);
const tiers = products.reduce((n, p) => n + (p.variants ?? []).reduce((m, v) => m + (v.priceTiers?.length ?? 0), 0), 0);
console.log(`fixture catalog: 2 brands, ${products.length} products, ${sizes} sizes, ${tiers} tiers`);

// 6. Prompt reseed logic, against the QA database.
run('scripts/reseed-prompt-defaults.ts');
console.log('QA database ready');
process.exit(0);
