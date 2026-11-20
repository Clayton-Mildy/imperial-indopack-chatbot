/**
 * prompt-sections.test.ts
 * Guards the prompt's route to production, and the rules that must survive a later rewrite.
 *
 * Two failure modes this catches, both of which look like nothing at all:
 *   1. A rule gets edited away during a later prompt rewrite. Nothing errors; the bot just starts
 *      doing the thing again.
 *   2. A section is edited but never listed in promptSync's SECTIONS_TO_SYNC, so
 *      `resolveIdentitySection` keeps serving each number's own older snapshot and the change never
 *      reaches a live conversation. That one is invisible in dev, where no snapshot exists and the
 *      constant is used directly.
 *
 * What each section must state for Imperial Indopack is in prompt-content.test.ts.
 * Reads only committed files - no DATABASE_URL, no API key.
 */

import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT_SECTIONS, SYSTEM_PROMPT_BEHAVIORAL_RULES } from '../src/domain/constants.js';
import { SECTIONS_TO_SYNC, SECTIONS_NOT_SYNCED } from '../src/domain/promptSync.js';

const section = (name: string): string => {
  const found = SYSTEM_PROMPT_SECTIONS.find((s) => s.name === name);
  expect(found, `prompt section "${name}" is missing`).toBeDefined();
  return found!.content;
};

describe('reseed-prompt-defaults.ts', () => {
  it('syncs every section but the per-number Identity', () => {
    for (const { name } of SYSTEM_PROMPT_SECTIONS) {
      if (name in SECTIONS_NOT_SYNCED) continue;
      expect(SECTIONS_TO_SYNC, `"${name}" is edited but never synced to live phone numbers`).toContain(name);
    }
    expect(Object.keys(SECTIONS_NOT_SYNCED)).toEqual(['Identity']);
  });

  it('only names sections that exist, or the script aborts at runtime', () => {
    const known = SYSTEM_PROMPT_SECTIONS.map((s) => s.name);
    expect(SECTIONS_TO_SYNC.length).toBeGreaterThan(0);
    for (const name of SECTIONS_TO_SYNC) expect(known).toContain(name);
  });

  it('lists the synced sections in shipped order, which inserts follow', () => {
    const shipped = SYSTEM_PROMPT_SECTIONS.map((s) => s.name).filter((n) => SECTIONS_TO_SYNC.includes(n));
    expect(SECTIONS_TO_SYNC).toEqual(shipped);
  });
});

// Each rule below was broken live in an earlier UAT and kept for this bot.
describe('rules that stay in the prompt', () => {
  it('Brands: "jual apa" names both product lines (live 2026-11-20: paper only, four times)', () => {
    expect(section('Brands')).toContain('sebutkan KEDUA lini dalam satu balasan');
    expect(section('Brands')).toContain('Jangan hanya menyebut salah satu');
  });

  it('Tone: English in, English out', () => {
    expect(section('Tone')).toContain('kalau pelanggan menulis dalam bahasa Inggris, jawab dalam bahasa Inggris');
  });

  it('Identity: one fixed disclosure line; Escalation: asking whether it is a bot is not asking for a person', () => {
    expect(section('Identity')).toContain('"Aku asisten virtual <merek> kak 😊 Kalau mau ngobrol langsung sama tim juga bisa ya."');
    // The brand in it follows PENGATURAN BOT, never both brands hard-coded (live 2026-11-20).
    expect(section('Identity')).toContain('<merek> diisi sesuai PENGATURAN BOT');
    expect(section('Identity')).not.toContain('Imperial Indopack & Kertas Supreme');
    expect(section('Escalation')).toContain('Pertanyaan apakah kamu bot atau orang');
  });

  // A plastics factory greeted "salam kenal saya Sari dari PT ..." was asked sales questions before it
  // said it had come to sell to us (client, 2026-11-02).
  it('Rules: a greeting with no need gets "ada yang bisa saya bantu?" and no name question', () => {
    const rules = section('Rules');
    expect(rules).toContain('Ada yang bisa saya bantu?" Jangan tanyakan nama di balasan itu');
    expect(rules).toContain('tanyakan nama di balasan yang sama');
  });

  it('Rules: "pikir-pikir dulu" is answered with one probing question, shown by example', () => {
    expect(section('Rules')).toMatch(/"pikir-pikir dulu"[^\n]*BUKAN penutup[^\n]*Boleh tahu yang masih dipertimbangkan apa/);
  });

  it('Escalation: a factory offering us its goods is a hand-off, a plain stock question is not', () => {
    const c = section('Escalation');
    expect(c).toContain('supplier atau pabrik yang menawarkan barang/jasa KEPADA kami');
    expect(c).toContain('"BUKAN PEMBELI:"');
    expect(c).toContain('Pertanyaan "ada?" / "ready?" biasa BUKAN eskalasi');
  });

  // UAT Run 2 F-09: after a hand-off every later sales question returned "low" and nobody could get a price.
  it('Escalation: a hand-off does not stop the bot answering, except chasers', () => {
    const c = section('Escalation');
    expect(c).toContain('Hand-off hanya MEMBERI TAHU tim; kamu tetap melayani');
    expect(c).toMatch(/hitung_harga → jawab seperti biasa, confidence "high"/);
    expect(c).toMatch(/"jadi gimana\?"[\s\S]{0,120}confidence "low" dan message kosong/);
  });

  it('PO Form: the team closes the order, the bot does not collect address or payment', () => {
    const c = section('PO Form');
    expect(c).toContain('JANGAN meminta alamat, pembayaran, atau bukti transfer');
    expect(c).toContain('JANGAN bilang pesanan sudah dikonfirmasi, dibayar, atau sedang diproduksi');
  });
});

describe('behavioural rules (shipped with the build)', () => {
  it('no talk about its own instructions, and links are ordinary messages', () => {
    expect(SYSTEM_PROMPT_BEHAVIORAL_RULES).toContain('Wah, itu nggak bisa aku bagikan ya kak');
    expect(SYSTEM_PROMPT_BEHAVIORAL_RULES).toContain('Link-nya untuk apa ya kak?');
  });

  it('an out-of-stock product is still relevant - answered, not handed off', () => {
    expect(SYSTEM_PROMPT_BEHAVIORAL_RULES).toContain('stoknya sedang habis TETAP relevan');
  });

  // Task 13 carry: one out-of-stock rule for an availability question and a price request alike.
  it('one out-of-stock rule: offer the ready sizes; the team only if the customer insists on that size', () => {
    const rule = SYSTEM_PROMPT_BEHAVIORAL_RULES.slice(SYSTEM_PROMPT_BEHAVIORAL_RULES.indexOf('- STOK HABIS:'));
    expect(rule).toMatch(/^- STOK HABIS:[^\n]*TETAP relevan/);
    expect(rule).toMatch(/Ditanya ada\/ready[^\n]*kosong[^\n]*ukuran lain yang ready/);
    expect(rule).toMatch(/Diminta harga ukuran yang kosong[^\n]*jangan sebut harga[^\n]*tawarkan dulu ukuran yang ready[^\n]*TETAP mau ukuran yang kosong[^\n]*confidence "low"/);
    // The Pricing section points here rather than handing every out-of-stock price to the team.
    const pricing = SYSTEM_PROMPT_SECTIONS.find((s) => s.name === 'Pricing')!.content;
    expect(pricing).toMatch(/\(c\)[^\n]*aturan STOK HABIS di ATURAN KATALOG TERTUTUP/);
  });

  // UAT Run 3 D-10: a fit claim about a product type named no product, and went out unchecked.
  it('binds fit claims about a product TYPE to the data too', () => {
    expect(SYSTEM_PROMPT_BEHAVIORAL_RULES).toContain('JENIS produk tanpa nama produknya');
  });

  // Imperial prints to order: an uncatalogued size is a custom job for the team, never "we do not carry it".
  it('a size or print outside the catalog is a custom job for the team, not a "belum ada"', () => {
    expect(SYSTEM_PROMPT_BEHAVIORAL_RULES).toMatch(/BUKAN barang yang tidak kami punya: itu pesanan custom/);
    expect(SYSTEM_PROMPT_BEHAVIORAL_RULES).toContain('Jangan pernah bilang custom tidak bisa');
  });

  // Replies go out through the respond_to_customer tool. A "reply in this JSON format" contract
  // here made the model write `message` as a JSON string, down to the next tool parameter (UAT Run 3 F-29).
  it('carry no JSON output contract', () => {
    expect(SYSTEM_PROMPT_BEHAVIORAL_RULES).not.toMatch(/format JSON|"message"\s*:|"confidence"\s*:/);
    expect(SYSTEM_PROMPT_BEHAVIORAL_RULES).toContain('lewat tool respond_to_customer');
  });
});
