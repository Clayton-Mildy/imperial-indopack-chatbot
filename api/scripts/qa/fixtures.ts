/** The QA fixture catalog (one row per price tier) and the generated files. Synthetic only. */
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import sharp from 'sharp';
import writeExcelFile from 'write-excel-file/node';
import { TEMPLATE_COLUMNS, TEMPLATE_SHEET } from '../../src/services/catalogTemplate.js';

export const FILES_DIR = join(process.cwd(), 'scripts', 'qa', 'fixtures', 'files');
export const PRICE_LIST_FILES = {
  kertas_supreme: { stored: 'qa-daftar-harga-kertas-supreme.pdf', name: 'Daftar Harga Kertas Supreme (QA).pdf' },
  imperial_indopack: { stored: 'qa-daftar-harga-imperial-indopack.pdf', name: 'Daftar Harga Imperial Indopack (QA).pdf' },
} as const;
export const REFERENCE_PHOTO_NAMES = ['qa-ref-1.png', 'qa-ref-2.png'] as const;

type Tier = [minQty: number, price: number];
interface Fx { brand: string; product: string; size: string; unit: 'rim' | 'pcs'; delivery: 'ya' | 'tidak'; use: string; tiers: Tier[] }

const FIXTURES: Fx[] = [
  { brand: 'Kertas Supreme', product: 'Kertas Supreme 64 gsm cetak 1 warna', size: '30 x 30 cm', unit: 'rim', delivery: 'tidak', use: 'Pembungkus nasi, gorengan dan makanan kering', tiers: [[5, 185_000], [10, 165_000], [20, 160_000]] },
  { brand: 'Kertas Supreme', product: 'Kertas Supreme 64 gsm cetak 1 warna', size: '35 x 35 cm', unit: 'rim', delivery: 'tidak', use: 'Pembungkus nasi, gorengan dan makanan kering', tiers: [[5, 245_000], [10, 217_500], [20, 207_000]] },
  { brand: 'Kertas Supreme', product: 'Greaseproof 40 gsm polos', size: '30 x 30 cm', unit: 'rim', delivery: 'tidak', use: 'Pembungkus makanan berminyak, anti tembus minyak', tiers: [[5, 150_000]] },
  { brand: 'Imperial Indopack', product: 'Box Ivory 270 gsm cetak full color', size: '21 x 14 x 5 cm', unit: 'pcs', delivery: 'ya', use: 'Box kue dan makanan', tiers: [[5, 1_900], [10, 1_500]] },
  { brand: 'Imperial Indopack', product: 'Box Ivory 310 gsm cetak full color', size: '20 x 20 x 7,5 cm', unit: 'pcs', delivery: 'ya', use: 'Box kue dan makanan', tiers: [[5, 2_000], [10, 1_800], [20, 1_500]] },
];

/** Catalog rows: every tier's minimum is in rim (500 pcs), the price per rim (paper) or per pcs (boxes). */
export function fixtureRows(): unknown[][] {
  const rows: unknown[][] = [[...TEMPLATE_COLUMNS]];
  for (const f of FIXTURES) {
    for (const [min, price] of f.tiers) {
      // Merek, Produk, Ukuran, Gramasi, Cetak, Finishing, Kegunaan, Min Qty, Satuan Qty, Harga, Satuan Harga, Ongkir, Catatan
      rows.push([f.brand, f.product, f.size, null, null, null, f.use, min, 'rim', price, f.unit, f.delivery, null]);
    }
  }
  return rows;
}

export async function buildFixtureWorkbook(): Promise<Buffer> {
  const [header, ...body] = fixtureRows();
  const data = [
    header!.map((value) => ({ value, fontWeight: 'bold' as const })),
    ...body.map((r) => r.map((v, i) => (i === 9 ? { value: v, type: Number } : v))),
  ];
  return writeExcelFile([{ sheet: TEMPLATE_SHEET, data }] as never).toBuffer();
}

/** A tiny but valid one-page PDF (readers accept %PDF- in the first KB). */
function pdfBytes(title: string): Buffer {
  const text = title.replace(/[()\\]/g, '');
  const stream = `BT /F1 18 Tf 50 750 Td (${text}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const svg = (w: number, h: number, body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`);

/** Writes the price-list PDFs, the reference photos and the customer's logo/photo files. Returns the stored urls. */
export async function writeFixtureFiles(): Promise<{ priceListUrls: Record<keyof typeof PRICE_LIST_FILES, string>; referenceUrls: string[] }> {
  const catalogs = join(process.cwd(), 'uploads', 'catalogs');
  const images = join(process.cwd(), 'uploads', 'images');
  await Promise.all([mkdir(catalogs, { recursive: true }), mkdir(images, { recursive: true }), mkdir(FILES_DIR, { recursive: true })]);

  const priceListUrls = {} as Record<keyof typeof PRICE_LIST_FILES, string>;
  for (const [slug, f] of Object.entries(PRICE_LIST_FILES) as [keyof typeof PRICE_LIST_FILES, (typeof PRICE_LIST_FILES)[keyof typeof PRICE_LIST_FILES]][]) {
    await writeFile(join(catalogs, f.stored), pdfBytes(f.name));
    priceListUrls[slug] = `/uploads/catalogs/${f.stored}`;
  }

  const referenceUrls: string[] = [];
  const colours = ['#c8a165', '#8fb996'];
  for (const [i, name] of REFERENCE_PHOTO_NAMES.entries()) {
    await sharp(svg(600, 600, `<rect width="600" height="600" fill="${colours[i]}"/><rect x="150" y="150" width="300" height="300" fill="#fff"/><text x="300" y="315" font-size="34" text-anchor="middle" fill="#333">Contoh cetak ${i + 1}</text>`)).png().toFile(join(images, name));
    referenceUrls.push(`/uploads/images/${name}`);
  }

  // What a customer sends: a logo, and two photos.
  await sharp(svg(500, 500, `<rect width="500" height="500" fill="#fff"/><circle cx="250" cy="250" r="200" fill="#c0392b"/><text x="250" y="240" font-size="44" font-weight="bold" text-anchor="middle" fill="#fff">RM SIANG</text><text x="250" y="295" font-size="44" font-weight="bold" text-anchor="middle" fill="#fff">CONTOH</text>`)).png().toFile(join(FILES_DIR, 'logo.png'));
  await sharp(svg(600, 600, `<rect width="600" height="600" fill="#d9d9d9"/><rect x="120" y="200" width="360" height="200" fill="#a67c52"/>`)).png().toFile(join(FILES_DIR, 'photo-1.png'));
  await sharp(svg(600, 600, `<rect width="600" height="600" fill="#e8e0d0"/><circle cx="300" cy="300" r="140" fill="#7f8c8d"/>`)).png().toFile(join(FILES_DIR, 'photo-2.png'));
  return { priceListUrls, referenceUrls };
}
