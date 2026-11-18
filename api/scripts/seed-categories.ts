/**
 * seed-categories.ts
 * Inserts the canonical category taxonomy (the 37 names the rule table in
 * scripts/lib/categorize-product.ts matches against) with short descriptions
 * used by the AI prompt ("Kategori: name — description") and RAG scoring.
 * Idempotent: skips names that already exist (case-insensitive). Never
 * deletes or renames — KC curates further via the dashboard.
 *
 * These descriptions are ROUTING HINTS, not evidence of fit. They must never name a material or
 * application the products' own Excel fields don't support: the AI sees them beside the
 * Excel-derived Fungsi/Bahan and will follow the prose when they disagree.
 * tests/catalog-claims.test.ts enforces this.
 *
 * Usage: npx tsx scripts/seed-categories.ts
 * After: npx tsx scripts/backfill-product-categories.ts [--dry-run]
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@localhost:5432/imperial_indopack';

const CATEGORIES: Record<string, string> = {
  'Door Handle Tanggung Wide': 'Handle pintu ukuran tanggung dengan plat lebar, untuk pintu kamar/ukuran sedang berangka lebar.',
  'Handle Pintu Aluminium': 'Handle khusus pintu aluminium atau pintu berangka sempit.',
  'Door Handle Pisah': 'Handle pintu model pisah (roses terpisah), dipasang dengan body kunci tanam.',
  'Door Handle Tanggung': 'Handle pintu ukuran tanggung (sedang), umumnya untuk pintu kamar.',
  'Door Handle Besar': 'Handle pintu ukuran besar, untuk pintu utama/pintu depan berdaun berat.',
  'Door Handle': 'Handle pintu ukuran kecil, untuk pintu berangka sempit atau ruangan kecil.',
  'Knob Handle': 'Knob/kenop pegangan untuk laci, lemari, dan furnitur.',
  'Door Stop': 'Penahan pintu agar tetap terbuka dan tidak terbanting.',
  'Door Closer': 'Penutup pintu otomatis, menutup pintu perlahan setelah dibuka.',
  'Door Pull': 'Handle tarikan pintu (pull handle) tanpa mekanisme kunci, untuk pintu dorong/tarik.',
  'Ball Valve': 'Stop kran air untuk instalasi pipa.',
  'Engsel Salon': 'Engsel jendela salon/casement (friction stay) untuk jendela bukaan luar.',
  'Engsel': 'Engsel pintu, jendela, dan furnitur.',
  'Gunting Seng': 'Gunting untuk memotong seng, plat metal, dan hollow.',
  'Gunting': 'Gunting kerja: dahan, serbaguna, dan pemotong lainnya.',
  'Grendel': 'Grendel/slot pengunci geser untuk pintu, jendela, lemari, dan pagar.',
  'Gembok': 'Gembok berbagai ukuran untuk pagar, gudang, koper, dan pengamanan lainnya.',
  'Betel Topi': 'Betel/pahat beton untuk pekerjaan bobok tembok dan beton.',
  'Body Lock': 'Body kunci tanam (mortise lock) — mekanisme kunci di dalam daun pintu.',
  'Cetok Semen': 'Cetok/sendok semen untuk pekerjaan pasangan dan plesteran.',
  'Gergaji': 'Gergaji kayu, plafon, dan dahan.',
  'Hak Angin': 'Hak angin penahan bukaan jendela agar tidak terbanting angin.',
  'Aksesoris Cat': 'Aksesori pengecatan: kapi, tongkat roll, dan perlengkapan cat lainnya.',
  'Kuas': 'Kuas dan roll cat.',
  'Ring Kunci': 'Ring/penutup lubang silinder kunci agar tampilan pintu rapi.',
  'Kunci Bulat': 'Kunci bulat (knob lock), umum untuk pintu kamar mandi.',
  'Lamskar': 'Lamskar tarik penahan jendela.',
  'Meteran': 'Meteran ukur: karet manual/auto lock dan meteran fiber untuk lahan.',
  'Obeng': 'Obeng dan set mata obeng.',
  'Palu': 'Palu kambing dan palu kerja lainnya.',
  'Silinder': 'Silinder kunci pintu (single/double open, kunci biasa/komputer).',
  'Spring Knife': 'Spring knife pengunci tambahan jendela agar rapat.',
  'Tarikan Laci': 'Tarikan/handle laci dan pintu lemari.',
  'Tang': 'Tang: kombinasi, potong, lancip, buaya, dan kakak tua.',
  'Tata Kayu': 'Tata/pahat kayu untuk pekerjaan perkayuan.',
  'Trowel Coratex': 'Trowel coratex untuk finishing tekstur dinding.',
  'Waterpass': 'Waterpass pengukur kedataran horizontal, vertikal, dan diagonal.',
};

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    const { rows } = await pool.query('SELECT name FROM categories');
    const existing = new Set(rows.map((r) => String(r.name).toLowerCase()));
    let inserted = 0;
    for (const [name, description] of Object.entries(CATEGORIES)) {
      if (existing.has(name.toLowerCase())) continue;
      await pool.query(
        'INSERT INTO categories (id, name, description) VALUES ($1, $2, $3)',
        [randomUUID(), name, description]
      );
      inserted++;
    }
    console.log(`✅ ${inserted} categories inserted, ${Object.keys(CATEGORIES).length - inserted} already existed`);
    console.log('👉 Next: npx tsx scripts/backfill-product-categories.ts --dry-run');
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});
