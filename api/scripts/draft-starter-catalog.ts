/**
 * Draft starter catalog from the client's quote workbook.
 *
 *   npx tsx scripts/draft-starter-catalog.ts "<path to workbook>" ../docs/client
 *
 * The workbook is ~430 price quotes, most addressed to named customers. The bot must only quote
 * generic catalog prices, so only blocks whose title uses nothing but generic product words are
 * kept; every other block is listed BY TITLE ONLY in starter-catalog-skipped.md (no prices, local
 * file, git-ignored because the titles are customer names). The output is the Task 4 template, so
 * the client reviews it in Excel and imports it through the dashboard.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import readXlsxFile from 'read-excel-file/node';
import writeExcelFile from 'write-excel-file/node';
import { TEMPLATE_COLUMNS, TEMPLATE_SHEET, parseTemplateRows } from '../src/services/catalogTemplate.js';

type Row = unknown[];
export interface ExtractResult { rows: Row[]; skipped: string[] }

const GENERIC_WORDS = new Set(
  ('PENAWARAN HARGA BOX KERTAS SUPREME GREASEPROOF GRASEPROOF PAPERBAG PAPER BAG SLEEVE SLEVEE ENVELOPE IVORY KRAFT PE ' +
    'LUNCH CETAK WARNA FULL COLOR BLOCK BLOK LAMINASI NON POLOS GSM GR UKURAN UK CM X').split(' ')
);
const IMPERIAL_WORDS = new Set(['BOX', 'IVORY', 'KRAFT', 'LUNCH']);

const DIMS = /\d+(?:[.,]\d+)?(?:\s*X\s*\d+(?:[.,]\d+)?)+/gi;
const TIER = /^\s*(?:MIN\s*)?\d[\d.,]*\s*(?:RIM|PCS)\b/i;
const DELIVERY = /\b(SUDAH|BELUM)\s+TERMASUK\s+(?:ONGKIR|ONGKOS)/i;

function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s === '' ? null : s;
}

/** Skipped titles are title words only: drop any "Rp" token and any token holding a run of 4+ digits. */
function safeTitle(t: string): string {
  return t
    .split(/\s+/)
    .filter((w) => !/^RP\.?$/i.test(w) && !/^RP\.?\d/i.test(w) && (w.replace(/\D/g, '').length < 4))
    .join(' ')
    .trim();
}

/** "2.500" / "5,000" / "1500" -> integer; a lone separator not followed by 3 digits is a decimal. */
function num(v: unknown): number {
  if (typeof v === 'number') return v;
  let s = (text(v) ?? '').replace(/^RP\.?\s*/i, '').replace(/\s/g, '');
  if (s === '') return NaN;
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, '');
  else s = s.replace(',', '.');
  return Number(s);
}

const words = (s: string) => s.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
const isGenericText = (s: string) => words(s.replace(DIMS, ' ')).every((w) => /^\d+$/.test(w) || GENERIC_WORDS.has(w));

/** "5 RIM / 2.500 PCS" -> 5 rim; "5.000 PCS / 10 RIM" -> 10 rim; "5.000 Pcs" -> 5000 pcs. */
function parseTier(label: string): { minQty: number; qtyUnit: 'rim' | 'pcs' } | null {
  const rim = /(\d[\d.,]*)\s*RIM/i.exec(label);
  const pcs = /(\d[\d.,]*)\s*PCS/i.exec(label);
  const m = rim ?? pcs;
  if (!m) return null;
  const minQty = num(m[1]);
  return Number.isInteger(minQty) && minQty > 0 ? { minQty, qtyUnit: rim ? 'rim' : 'pcs' } : null;
}

function fmtDims(s: string): string | null {
  const found = [...s.toUpperCase().matchAll(DIMS)].map((m) => m[0].replace(/\s*X\s*/g, ' x '));
  return found.length ? `${found.join(' & ')} cm` : null;
}

function findSize(...sources: (string | null)[]): string | null {
  for (const s of sources) {
    if (!s) continue;
    const dims = fmtDims(s);
    if (dims) return dims;
    const d = /DIAMETER\s+(\d+(?:[.,]\d+)?)\s*CM/i.exec(s);
    if (d) return `diameter ${d[1]} cm`;
  }
  return null;
}

const gsmOf = (s: string) => /(\d+)\s*(?:GSM|GR)\b/i.exec(s)?.[1] ?? null;

interface Draft {
  sourceTitle: string; // what goes in the skipped list when the block is dropped
  titleText: string; // generic-word title, as written
  subtitle: string | null;
  extras: string[];
  tiers: { minQty: number; qtyUnit: 'rim' | 'pcs'; price: number }[];
  priceUnit: 'rim' | 'pcs' | null;
  delivery: boolean | null;
}

function toRows(d: Draft): { rows: Row[] } | { reason: string } {
  if (!d.priceUnit) return { reason: 'tidak ada satuan harga' };
  if (d.delivery === null) return { reason: 'tidak ada baris ongkir' };
  if (d.tiers.length === 0) return { reason: 'tidak ada tier harga' };
  const perRimEq = (t: Draft['tiers'][number]) => (t.qtyUnit === 'rim' ? t.minQty : t.minQty / 500);
  if (d.priceUnit === 'pcs' ? d.tiers.some((t) => t.price > 20000) : d.tiers.some((t) => t.price < 20000)) return { reason: 'satuan harga mencurigakan' };
  const byQty = [...d.tiers].sort((x, y) => perRimEq(x) - perRimEq(y));
  if (byQty.some((t, i) => i > 0 && t.price > byQty[i - 1]!.price)) return { reason: 'harga naik dengan jumlah' };
  if (d.tiers.length === 1 && perRimEq(d.tiers[0]!) >= 100) return { reason: 'tier tunggal volume besar (penawaran sekali jalan)' };
  const size = findSize(d.subtitle?.match(/\b(?:UKURAN|UK)\b/i) ? d.subtitle : null, ...d.extras.filter((e) => /\b(?:UKURAN|UK)\b|DIAMETER|\bGSM\b/i.test(e) || fmtDims(e) !== null), d.titleText);
  if (!size) return { reason: 'tidak ada ukuran' };

  const all = [d.titleText, d.subtitle ?? '', ...d.extras].join(' ');
  const brand = words(d.titleText).some((w) => IMPERIAL_WORDS.has(w)) ? 'Imperial Indopack' : 'Kertas Supreme';

  // Title words minus size, UKURAN/UK and the CETAK clause (rebuilt below).
  let toks = words(d.titleText.replace(DIMS, ' ')).filter((w) => w !== 'UKURAN' && w !== 'UK');
  let cetak: string | null = null;
  const ci = toks.indexOf('CETAK');
  if (ci !== -1) {
    let end = ci + 1;
    while (end < toks.length && !(/^\d+$/.test(toks[end]!) && /^(GSM|GR)$/.test(toks[end + 1] ?? ''))) end++;
    cetak = toks.slice(ci + 1, end).join(' ').toLowerCase() || null;
    toks = [...toks.slice(0, ci), ...toks.slice(end)];
  }
  if (!cetak && d.subtitle) {
    const sub = words(d.subtitle.replace(DIMS, ' '));
    const si = sub.indexOf('CETAK');
    if (si !== -1 && sub.slice(si).every((w) => /^\d+$/.test(w) || GENERIC_WORDS.has(w) || w === 'CMYK')) cetak = sub.slice(si + 1).join(' ').toLowerCase() || null;
  }
  // The gramasi goes to its own column, not into the product name.
  toks = toks.filter((w, i) => !((/^\d+$/.test(w) && /^(GSM|GR)$/.test(toks[i + 1] ?? '')) || (/^(GSM|GR)$/.test(w) && /^\d+$/.test(toks[i - 1] ?? ''))));
  const gsm = gsmOf(d.titleText) ?? d.extras.map(gsmOf).find(Boolean) ?? null;
  const upper = all.toUpperCase();
  const grease = /GR[EA]SEPROOF/.test(upper);

  const fmt = (w: string) => (/^\d+$/.test(w) ? w : w === 'GSM' || w === 'GR' || w === 'CM' || w === 'X' ? w.toLowerCase() : w === 'PE' ? w : w[0] + w.slice(1).toLowerCase());
  const titleWords = toks.filter((w) => w !== 'PENAWARAN' && w !== 'HARGA').map(fmt);
  const hasNoun = toks.some((w) => ['BOX', 'PAPERBAG', 'PAPER', 'BAG', 'ENVELOPE', 'SLEEVE', 'SLEVEE', 'GREASEPROOF', 'GRASEPROOF', 'KERTAS', 'SUPREME'].includes(w));
  const prefix: string[] = [];
  if (!hasNoun) {
    if (/\bPAPERBAG\b/.test(upper)) prefix.push('Paperbag');
    else if (/ENVELOPE/.test(upper)) prefix.push('Paper envelope');
    else if (/\bBOX\b/.test(upper) || toks.some((w) => w === 'IVORY' || w === 'KRAFT')) prefix.push('Box');
    else prefix.push('Kertas');
    if (grease) prefix.push('greaseproof');
  }
  const name = [...prefix, ...titleWords, ...(cetak ? [`cetak ${cetak}`] : [])].join(' ').replace(/\s+/g, ' ').trim();
  if (!name) return { reason: 'tidak ada nama produk' };

  const finishing = /NON\s+LAMINASI/i.test(all) ? 'Non laminasi' : /LAMINASI/i.test(all) ? 'Laminasi' : null;
  const cetakCell = cetak ? cetak[0]!.toUpperCase() + cetak.slice(1) : null;
  return {
    rows: d.tiers.map((t) => [
      brand, name, size, gsm ? `${gsm} gsm` : null, cetakCell, finishing, null,
      t.minQty, t.qtyUnit, t.price, d.priceUnit, d.delivery ? 'ya' : 'tidak', null,
    ]),
  };
}

const priceUnitOf = (s: string | null): 'rim' | 'pcs' | null => (/PER\s*RIM/i.test(s ?? '') ? 'rim' : /PER\s*PCS/i.test(s ?? '') ? 'pcs' : null);

/** HARGA BOX: a PENAWARAN title cell (+ subtitle to its right), then QTY ORDER, tiers, ongkir, size lines. */
function scanHargaBox(sheet: Row[], out: { drafts: Draft[]; skipped: string[] }) {
  const width = Math.max(0, ...sheet.map((r) => r.length));
  for (let c = 0; c < width; c++) {
    // The nearest non-generic title above (a customer section) taints every block below it in this
    // column until another non-generic title replaces it: a later table under a customer header
    // is that customer's too, whatever its own sub-label says.
    let section = false;
    for (let r = 0; r < sheet.length; r++) {
      const head = text(sheet[r]?.[c]);
      if (!head || !/^PENAWARAN\b/i.test(head)) continue;
      const titleText = head.replace(/^PENAWARAN(?:\s+HARGA)?\s*/i, '').trim();
      const d: Draft = { sourceTitle: safeTitle(titleText) || '(tanpa judul)', titleText, subtitle: text(sheet[r]?.[c + 1]), extras: [], tiers: [], priceUnit: null, delivery: null };
      let blanks = 0;
      let bad = false;
      for (let i = r + 1; i < sheet.length; i++) {
        const cell = text(sheet[i]?.[c]);
        if (cell === null) {
          if (d.delivery !== null || ++blanks > 3) break;
          continue;
        }
        if (/^PENAWARAN\b/i.test(cell)) break;
        if (/^QTY\s*ORDER$/i.test(cell)) { d.priceUnit = priceUnitOf(text(sheet[i]?.[c + 1])); continue; }
        const delivery = DELIVERY.exec(cell);
        if (delivery) { d.delivery = delivery[1]!.toUpperCase() === 'SUDAH'; continue; }
        const tier = TIER.test(cell) ? parseTier(cell) : null;
        if (tier && d.delivery === null) {
          const price = num(sheet[i]?.[c + 1]);
          if (!Number.isInteger(price) || price <= 0) bad = true;
          else d.tiers.push({ ...tier, price });
          continue;
        }
        d.extras.push(cell);
      }
      if (!isGenericText(titleText)) { section = true; out.skipped.push(d.sourceTitle); continue; }
      if (!titleText) { out.skipped.push('(tanpa judul) [label kosong]'); continue; }
      if (section) { out.skipped.push(`${d.sourceTitle} [di bawah judul non-generik]`); continue; }
      if (bad) { out.skipped.push(`${d.sourceTitle} [harga tidak terbaca]`); continue; }
      out.drafts.push(d);
    }
  }
}

/** Pure: one sheet of cells in, template rows (no header) and skipped titles out. */
export function extractBlocks(sheet: unknown[][]): ExtractResult {
  const collected = { drafts: [] as Draft[], skipped: [] as string[] };
  scanHargaBox(sheet, collected);

  const skipped = [...collected.skipped];
  type Built = { d: Draft; rows: Row[] };
  const built: Built[] = [];
  for (const d of collected.drafts) {
    const res = toRows(d);
    if ('reason' in res) skipped.push(`${d.sourceTitle} [${res.reason}]`);
    else built.push({ d, rows: res.rows });
  }

  // The same product + size + tier at different prices means the price was negotiated for someone:
  // drop every such variant, never "first wins".
  const variantKey = (r: Row) => [r[0], r[1], r[2]].map((v) => String(v).toLowerCase()).join('|');
  const prices = new Map<string, Set<unknown>>();
  for (const b of built) for (const r of b.rows) {
    const k = `${variantKey(r)}|${r[7]}|${r[8]}`;
    (prices.get(k) ?? prices.set(k, new Set()).get(k)!).add(r[9]);
  }
  const conflicted = new Set<string>();
  for (const [k, set] of prices) if (set.size > 1) conflicted.add(k.split('|').slice(0, 3).join('|'));

  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const b of built) {
    const key = variantKey(b.rows[0]!);
    if (conflicted.has(key)) { skipped.push(`${b.d.sourceTitle} [harga beda untuk produk dan ukuran yang sama]`); continue; }
    if (seen.has(key)) continue; // identical repeat of an already kept block
    seen.add(key);
    rows.push(...b.rows);
  }
  return { rows, skipped };
}

async function main() {
  const [workbook, outDir] = process.argv.slice(2);
  if (!workbook || !outDir) {
    console.error('Usage: npx tsx scripts/draft-starter-catalog.ts "<workbook.xlsx>" <outDir>');
    process.exit(1);
  }
  const sheets = await readXlsxFile(workbook);
  const rows: Row[] = [];
  const skipped: string[] = [];
  // PRICE LIST CETAK is deliberately not read: every table in it sits under a customer or shop header.
  for (const name of ['HARGA BOX']) {
    const s = sheets.find((x) => x.sheet.trim().toUpperCase() === name);
    if (!s) throw new Error(`Sheet "${name}" not found in the workbook.`);
    const r = extractBlocks(s.data as unknown[][]);
    console.log(`${name}: ${r.rows.length} tier rows kept, ${r.skipped.length} blocks skipped`);
    rows.push(...r.rows);
    skipped.push(...r.skipped);
  }

  // The draft must always import cleanly: fail loudly rather than hand the client a broken file.
  const parsed = parseTemplateRows([[...TEMPLATE_COLUMNS], ...rows]);
  if (parsed.errors.length > 0) {
    throw new Error(`Draft rows do not pass the catalog template:\n${parsed.errors.map((e) => `row ${e.row}: ${e.message}`).join('\n')}`);
  }

  await mkdir(outDir, { recursive: true });
  const header = TEMPLATE_COLUMNS.map((value) => ({ value, fontWeight: 'bold' as const }));
  const body = rows.map((r) => r.map((v, i) => (i === 9 ? { value: v as number, type: Number, format: '#,##0' } : (v ?? null))));
  const buffer = await writeExcelFile([{ sheet: TEMPLATE_SHEET, stickyRowsCount: 1, data: [header, ...body] }] as never).toBuffer();
  await writeFile(path.join(outDir, 'starter-catalog-draft.xlsx'), buffer);

  const counts = new Map<string, number>();
  for (const t of skipped) counts.set(t, (counts.get(t) ?? 0) + 1);
  const list = [...counts].map(([t, n]) => `- ${t}${n > 1 ? ` (x${n})` : ''}`).join('\n');
  await writeFile(
    path.join(outDir, 'starter-catalog-skipped.md'),
    `# Blocks skipped from the starter catalog\n\nTitles only (never prices). Local file: it names customers, so it is git-ignored.\n\n${list}\n`
  );
  console.log(`${parsed.variants.length} variants, ${rows.length} tier rows, ${skipped.length} skipped -> ${outDir}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
