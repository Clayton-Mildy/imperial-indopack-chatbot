/**
 * prompt-content.test.ts
 * The shipped prompt speaks as Imperial Indopack / Kertas Supreme (spec 7.4) and states the rules
 * the code enforces: prices only from hitung_harga with "Rp" in front (the strict price check reads
 * only "Rp N" figures), the PO link and photos attached by code, and none of the old hardware business.
 * Reads only committed files - no DATABASE_URL, no API key.
 */

import { describe, it, expect } from 'vitest';
import {
  SYSTEM_PROMPT_SECTIONS,
  SYSTEM_PROMPT_BEHAVIORAL_RULES,
  KAMUS_ISTILAH,
  ASK_NAME_REPLY,
  CANNED_COMPLAINT_REPLY,
  CANNED_NON_SALES_REPLY,
  CANNED_STILL_CHECKING_REPLY,
  CANNED_UNSUPPORTED_MEDIA_REPLY,
} from '../src/domain/constants.js';
import { RESPOND_FIELD_DESC, JUDGE_SYSTEM_PROMPT, TOOL_USE_SEARCH_INSTRUCTION } from '../src/services/aiLayer.js';

const all = SYSTEM_PROMPT_SECTIONS.map((s) => s.content).join('\n') + SYSTEM_PROMPT_BEHAVIORAL_RULES;
const section = (name: string): string => {
  const found = SYSTEM_PROMPT_SECTIONS.find((s) => s.name === name);
  expect(found, `prompt section "${name}" is missing`).toBeDefined();
  return found!.content;
};
// The hardware business this bot was ported from: its brand name is checked on each line below.
const OLD_BUSINESS_RE = /reseller|showroom|PRICELIST|engsel|handle pintu|dipakai sendiri/i;

describe('Imperial Indopack prompt', () => {
  it('has the Imperial Indopack sections in order', () =>
    expect(SYSTEM_PROMPT_SECTIONS.map((s) => s.name)).toEqual(['Identity', 'Mission', 'Tone', 'Brands', 'Order Details', 'Recommendations', 'Pricing', 'Design', 'PO Form', 'Rules', 'Escalation']));

  it('names both brands and the price tool', () => {
    expect(all).toContain('Imperial Indopack');
    expect(all).toContain('Kertas Supreme');
    expect(all).toContain('hitung_harga');
  });

  it('carries none of the old hardware business', () => {
    expect(all).not.toMatch(OLD_BUSINESS_RE);
    expect(all).not.toMatch(/legacy/i);
  });

  it('carries no buyer type, MP price or discount tiers', () =>
    expect(all).not.toMatch(/tipe pembeli|dijual lagi|untuk proyek|harga MP|\bMP:|diskon reseller|pengguna akhir/i));

  it('canned replies carry none of the old hardware business', () =>
    expect([CANNED_COMPLAINT_REPLY, CANNED_NON_SALES_REPLY, CANNED_STILL_CHECKING_REPLY, CANNED_UNSUPPORTED_MEDIA_REPLY].join(' ')).not.toMatch(/legacy|hardware/i));

  it('the term list is about paper and boxes', () => {
    expect(KAMUS_ISTILAH).toContain('rim');
    expect(KAMUS_ISTILAH).toContain('gsm');
    expect(KAMUS_ISTILAH).not.toMatch(OLD_BUSINESS_RE);
    expect(KAMUS_ISTILAH).not.toMatch(/legacy/i);
    expect(KAMUS_ISTILAH).not.toMatch(/PELOR|TANGGUNG|SALON|DATA KATALOG RESMI/);
  });
});

describe('the facts each section must state', () => {
  it('Identity: the name and first greeting come from PENGATURAN BOT, not from the text', () => {
    expect(section('Identity')).toContain('PENGATURAN BOT');
    expect(section('Identity')).not.toContain('Admin');
    expect(section('Identity')).not.toContain('Rina');
  });

  it('Brands: boxes are Imperial Indopack, wrapping paper and the extra paper items Kertas Supreme', () => {
    const c = section('Brands');
    expect(c).toMatch(/Imperial Indopack[^\n]*box/i);
    expect(c).toMatch(/Kertas Supreme[^\n]*kertas/i);
    for (const item of ['greaseproof', 'paper bag', 'paper sleeve', 'amplop']) expect(c.toLowerCase()).toContain(item);
  });

  it('Order Details: the six details, one or two questions at a time, never re-asked', () => {
    const c = section('Order Details');
    for (const detail of ['nama', 'nama usaha', 'model', 'desain', 'jumlah', 'ukuran']) expect(c.toLowerCase()).toContain(detail);
    expect(c).toMatch(/satu atau dua pertanyaan/i);
    expect(c).toMatch(/jangan[^\n]*(?:tanya|menanyakan)[^\n]*(?:lagi|ulang)/i);
  });

  it('Order Details: an item already mentioned is resent with the same product and size', () =>
    expect(section('Order Details')).toMatch(/product[^\n]*size[^\n]*SAMA|SAMA[^\n]*product[^\n]*size/));

  it('Recommendations: wrap -> Kertas Supreme or greaseproof, catering/lunch/cookie -> box, takeaway -> paper bag', () => {
    const c = section('Recommendations');
    expect(c).toMatch(/nasi padang[^\n]*Kertas Supreme/i);
    expect(c).toMatch(/kebab|burger/i);
    expect(c).toMatch(/greaseproof/i);
    expect(c).toMatch(/katering[^\n]*Imperial Indopack/i);
    expect(c).toMatch(/takeaway[^\n]*paper bag/i);
  });

  it('Pricing: hitung_harga for every quantity, its four answers, units, delivery, next tier', () => {
    const c = section('Pricing');
    for (const word of ['hitung_harga', 'DI_BAWAH_MINIMUM', 'DI_ATAS_TINGKAT_TERATAS', 'TIDAK_ADA_DI_KATALOG', 'per pcs', 'per rim', 'ongkir']) expect(c).toContain(word);
    expect(c).toMatch(/DI_ATAS_TINGKAT_TERATAS[^\n]*confidence "low"|confidence "low"[^\n]*DI_ATAS_TINGKAT_TERATAS/);
    expect(c).toMatch(/tingkat berikutnya/i);
    expect(c).toMatch(/pelanggan lain/i);
  });

  // Review fix (Task 10 I2): TIDAK_ADA_DI_KATALOG has three causes, each with its own step, stated once.
  it('Pricing: TIDAK_ADA_DI_KATALOG by its cause - several products, an unknown size, nothing to price', () => {
    const c = section('Pricing');
    expect(c).toMatch(/\(a\)[^\n]*lebih dari satu produk[^\n]*hitung_harga lagi[^\n]*nama produk persis[^\n]*gsm/);
    expect(c).toMatch(/\(b\)[^\n]*Ukuran yang ada[^\n]*SEKALI[^\n]*custom[^\n]*confidence "low"/);
    expect(c).toMatch(/\(c\)[^\n]*stok habis[^\n]*STOK HABIS[^\n]*ukuran yang ready[^\n]*"low" hanya kalau pelanggan tetap mau/);
    expect(c).toMatch(/\(d\)[^\n]*tidak ada di katalog[^\n]*belum punya harga[^\n]*confidence "low"/);
    // Out of stock is no longer a straight hand-off.
    expect(c).not.toMatch(/\(d\)[^\n]*stok habis/);
    expect(c).not.toMatch(/(?:atau|dan) TIDAK_ADA_DI_KATALOG: → jangan sebut harga/);
  });

  it('the custom-job rule lives in Pricing only; other places point to it', () => {
    expect(section('Escalation')).toContain('lihat Pricing');
    expect(section('Escalation')).not.toMatch(/TIDAK_ADA_DI_KATALOG/);
    expect(SYSTEM_PROMPT_BEHAVIORAL_RULES).toMatch(/PESANAN CUSTOM[^]*TIDAK_ADA_DI_KATALOG di Pricing/);
    expect(SYSTEM_PROMPT_BEHAVIORAL_RULES).not.toMatch(/Sebutkan dulu ukuran yang ada di katalog/);
    expect(TOOL_USE_SEARCH_INSTRUCTION).not.toMatch(/TIDAK_ADA_DI_KATALOG: → tanpa harga, confidence "low"/);
  });

  // Review fix (Task 10 m3): the strict check takes only tool figures once the tool ran this turn.
  it('Pricing: once hitung_harga ran this turn, every price in the reply comes from it', () =>
    expect(section('Pricing')).toMatch(/hitung_harga sudah dipanggil[^\n]*SEMUA harga[^\n]*setiap barang/));

  it('Pricing: every price figure is written "Rp N" - no ribu, rb, IDR or ranges', () => {
    const c = section('Pricing');
    expect(c).toContain('"Rp"');
    for (const banned of ['ribu', 'rb', 'IDR']) expect(c).toContain(`"${banned}"`);
    expect(c).toMatch(/rentang/i);
  });

  it('Design: a logo sets has_design; no design gets image_urls from the reference photos, else the team', () => {
    const c = section('Design');
    expect(c).toContain('has_design');
    expect(c).toContain('image_urls');
    expect(c).toContain('[FOTO REFERENSI TERSEDIA]');
    expect(c).toMatch(/tim/);
  });

  // Task 13 carry: the team's examples promise is made once per conversation (messageRouter enforces it too).
  it('Design: examples_for_team once only', () =>
    expect(section('Design')).toMatch(/examples_for_team: true[^\n]*Sekali saja[^\n]*jangan set lagi/));

  // Review fix (Task 10 I1): the team is told through the flag; the model does not promise it itself.
  it('Design: no reference photos sets examples_for_team instead of promising examples itself', () => {
    const c = section('Design');
    expect(c).toMatch(/tidak ada baris itu[^\n]*examples_for_team: true/i);
    expect(c).toMatch(/JANGAN[^\n]*menulis[^\n]*tim[^\n]*contoh/i);
    expect(c).not.toContain('follow_up_notes');
  });

  it('PO Form: send_po_form only on agreement, and the model never writes the link or the form line', () => {
    const c = section('PO Form');
    expect(c).toContain('send_po_form');
    expect(c).toMatch(/JANGAN[^\n]*link/i);
    expect(c).toMatch(/JANGAN[^\n]*(?:isi|mengisi)[^\n]*form/i);
    // Review fix (Task 10 m4): the order is repeated back, not "confirmed".
    expect(c).toContain('ulangi singkat pesanannya');
    expect(c).not.toContain('konfirmasi singkat pesanannya');
  });

  // Review fix (Task 10 m4): the close-line names no PO form, and a reply may end without a question.
  it('Rules: the next step closes a reply when there is one, and a closed answer needs no question', () => {
    const close = section('Rules').split('\n').find((l) => l.includes('langkah berikutnya'))!;
    expect(close).not.toMatch(/form PO/);
    expect(close).toMatch(/tanpa pertanyaan/);
    expect(close).toMatch(/belum (?:tersedia|ada)/);
  });

  it('behavioural rules talk about image_urls, never image_url', () => {
    expect(SYSTEM_PROMPT_BEHAVIORAL_RULES).toContain('image_urls');
    expect(SYSTEM_PROMPT_BEHAVIORAL_RULES).not.toMatch(/image_url\b/);
    expect(SYSTEM_PROMPT_BEHAVIORAL_RULES).not.toMatch(/DATA KATALOG RESMI|Kategori \(petunjuk pencarian\)|Playbook/);
  });

  it('the name question has no buyer-type wording', () => {
    expect(ASK_NAME_REPLY).toMatch(/dengan siapa/);
    expect(ASK_NAME_REPLY).not.toMatch(OLD_BUSINESS_RE);
    expect(ASK_NAME_REPLY).not.toMatch(/legacy/i);
  });
});

describe('tool and field text', () => {
  it('search instruction keeps web_search and resolve_link, drops the website tool and the buyer-type check, and adds the price tool', () => {
    expect(TOOL_USE_SEARCH_INSTRUCTION).toContain('web_search');
    expect(TOOL_USE_SEARCH_INSTRUCTION).toContain('resolve_link');
    expect(TOOL_USE_SEARCH_INSTRUCTION).toContain('KALKULATOR HARGA (hitung_harga)');
    expect(TOOL_USE_SEARCH_INSTRUCTION).not.toMatch(/search_legacy_website|reseller|legacy/i);
  });

  it('the judge checks for a paper and box seller', () => {
    expect(JUDGE_SYSTEM_PROMPT).toContain('customer service penjual kemasan kertas dan box karton');
    expect(JUDGE_SYSTEM_PROMPT).not.toMatch(/toko hardware|pricelist|BNSN|Lusin/i);
  });

  it('no respond_to_customer field mentions the old business, the buyer type or the old catalog fields', () => {
    const fields = Object.values(RESPOND_FIELD_DESC).join('\n');
    expect(fields).not.toMatch(/legacy|reseller|end-user|project fields|DATA KATALOG RESMI|Kategori \(petunjuk pencarian\)|Playbook|Scope line/i);
    expect(RESPOND_FIELD_DESC.profile_update).toMatch(/business_name/);
    expect(RESPOND_FIELD_DESC.profile_update).toMatch(/same product and size/i);
    expect(RESPOND_FIELD_DESC.fit_basis).toMatch(/Kegunaan/);
  });
});
