/**
 * prompt-sections.test.ts
 * Guards the pricing policy's presence in the prompt, and its route to production.
 *
 * Two failure modes this catches, both of which look like nothing at all:
 *   1. A rule gets edited away during a later prompt rewrite. Nothing errors; the bot just
 *      starts quoting reseller prices to walk-in customers again.
 *   2. A section is edited but never listed in reseed-prompt-defaults.ts's SECTIONS_TO_SYNC,
 *      so `resolveIdentitySection` keeps serving each number's own older snapshot and the
 *      change never reaches a live conversation. That one is invisible in dev, where no
 *      snapshot exists and the constant is used directly.
 *
 * Reads only committed files - no DATABASE_URL, no API key.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { SYSTEM_PROMPT_SECTIONS, SYSTEM_PROMPT_BEHAVIORAL_RULES, END_USER_CATALOG_URL } from '../src/domain/constants.js';
import { SECTIONS_TO_SYNC } from '../src/domain/promptSync.js';
import { DISCOUNT_TIERS } from '../src/services/replyChecks.js';

const section = (name: string): string => {
  const found = SYSTEM_PROMPT_SECTIONS.find((s) => s.name === name);
  expect(found, `prompt section "${name}" is missing`).toBeDefined();
  return found!.content;
};

describe('Kebijakan Harga', () => {
  const content = (): string => section('Kebijakan Harga');

  it('sits immediately before Escalation, where reseed-prompt-defaults inserts it', () => {
    // The script splices each missing section in front of Escalation, in SECTIONS_TO_SYNC order.
    // Matching that here keeps a freshly seeded install and a patched one in the same order.
    const names = SYSTEM_PROMPT_SECTIONS.map((s) => s.name);
    const esc = names.indexOf('Escalation');
    expect(names.slice(esc - 2, esc)).toEqual(['Kebijakan Harga', 'Kebijakan Diskon Reseller']);
  });

  it('binds each buyer type to a price', () => {
    const c = content();
    expect(c).toMatch(/pengguna akhir.*RETAIL|RETAIL.*pengguna akhir/is);
    expect(c).toMatch(/proyek.*PRICELIST/is);
    expect(c).toMatch(/reseller.*PRICELIST/is);
  });

  it('forbids leaking the pricelist price, the markup, or the arithmetic', () => {
    const c = content();
    expect(c).toContain('JANGAN PERNAH menyebutkan harga pricelist kepada pembeli pengguna akhir');
    expect(c).toContain('JANGAN menghitung sendiri harga');
    expect(c).toMatch(/markup/i);
  });

  it('scopes the "price list" vocabulary to reseller conversations only', () => {
    // The reseller playbook itself says "price list resmi" — banning the words everywhere
    // contradicted it (seen live: a compliant reseller reply flagged for saying them).
    // "retail"/"markup" stay banned for everyone.
    const c = content();
    expect(c).toContain('boleh muncul HANYA dalam percakapan dengan reseller');
    expect(c).toContain('JANGAN pernah menyebutnya ke pengguna akhir atau pembeli proyek');
  });

  it('keeps bulk end-user orders at retail and sends discount asks to the team', () => {
    expect(content()).toContain('Jumlah besar TIDAK mengubah harga');
  });

  it('gates the reseller price behind store details plus a web check, without blocking on it', () => {
    const c = content();
    expect(c).toContain('nama toko');
    expect(c).toContain('alamat');
    expect(c).toContain('web_search');
    // Best-effort, per the owner: an unfindable small shop still gets the pricelist.
    expect(c).toContain('BUKAN alasan menolak');
  });

  // Live failure 2026-08-20: a turn-1 "harganya berapa? untuk dijual kembali" got the pricelist
  // figure immediately, store questions after — the Rules' answer-price-first rule beat the
  // store gate. The precedence must be stated in BOTH colliding rules, or the model picks one.
  it('states that the store gate beats every answer-price-first rule', () => {
    expect(content()).toContain('MENGALAHKAN aturan "jawab harga dulu"');
    expect(section('Rules')).toContain('KALAH oleh gerbang harga di Kebijakan Harga');
    expect(section('Kebijakan Reseller/Agen')).toContain('KECUALI pertanyaan HARGA');
  });

  it('bans comparing the quoted price against the other tier', () => {
    // "jauh lebih terjangkau dari harga retail" leaked the two-price structure, live.
    expect(content()).toContain('JANGAN membandingkan harga yang kamu sebutkan dengan harga untuk tipe pembeli lain');
  });

  // Live failure 2026-08-20 #2: after a maps link, the bot said "sebelum aku kasih harga,
  // boleh tahu nama tokonya?" AND gave the price two sentences later — in one message.
  it('forbids mixing the gate question and a price in one reply', () => {
    expect(content()).toContain('SATU BALASAN, SATU SISI GERBANG');
  });

  it('treats a customer-sent store link as identity to be fetched, never bluffed about', () => {
    const c = content();
    // Tool-agnostic on purpose: this section is DB-seeded and outlives any single build. A
    // DB prompt naming a build-shipped tool broke live when an older server served the new
    // prompt (2026-08-20). Tool mechanics live in TOOL_USE_SEARCH_INSTRUCTION, which ships
    // with the build that has the tool.
    expect(c).toContain('tool pembuka tautan yang tersedia');
    expect(c).not.toContain('resolve_link');
    expect(c).toContain('jangan tanyakan lagi apa yang sudah tertulis di tautannya');
    expect(c).toContain('jangan pernah mengaku sudah melihatnya');
  });

  it('escalates a clearly-invalid store, stays best-effort on an inconclusive one', () => {
    const c = content();
    expect(c).toContain('JELAS BUKAN toko');
    expect(c).toContain('JANGAN menuduh customer');
    // The owner's earlier call stands: no web footprint still gets the pricelist.
    expect(c).toContain('hasil kosong/tidak meyakinkan tetap best-effort');
    // The customer's own words are evidence too — "bengkel jaya motor" said in chat is the
    // same finding as the maps link showing a motorcycle repair shop.
    expect(c).toContain('ATAU kata-kata customer sendiri');
  });

  // Live failure 2026-08-20 #3: an hour after the bengkel was escalated for validation, the
  // customer restated the store name and got the pricelist plus a fabricated "sudah terdaftar".
  it('keeps the gate locked while the team checks, and bans fake verification claims', () => {
    const c = content();
    expect(c).toContain('GERBANG TIDAK BISA DIBUKA ULANG SELAGI TIM MEMERIKSA');
    expect(c).toContain('TIDAK membuka kunci');
    expect(c).toContain('"sudah terdaftar"');
  });

  // The other half of that lock, and the failure it caused. The bot asked "boleh tahu nama
  // toko atau usaha kakak ya?", the customer answered it the next day - and the lock above
  // read that first answer as a restatement, held confidence "low", and the router replaced
  // the reply with the canned ack. The lock must bite on repeats, never on a first answer.
  it('lets a FIRST answer to the gate question through, while still refusing a restatement', () => {
    const c = content();
    expect(c).toContain('JAWABAN PERTAMA KALI BUKAN PENGULANGAN');
    expect(c).toContain('SUDAH pernah disebutkan di riwayat chat ini');
    // It must say what to do instead, not merely that the lock does not apply.
    expect(c).toMatch(/fakta BARU[\s\S]{0,400}confidence "high"/);
  });

  it('sets the reseller minimum at one dozen and multiples', () => {
    expect(content()).toContain('1 lusin (12 pcs) dan kelipatannya');
  });

  it('routes an end-user price with no MP, and PPN questions, to the team', () => {
    const c = content();
    // The rule is keyed on the catalog rendering "MP: tanya tim", not on a brand allow-list -
    // formatProducts drops the figure for any variant without one, Shind or otherwise. Shind is
    // still named because the product-detail half of the hand-off is brand-specific.
    expect(c).toMatch(/Shind/);
    expect(c).toContain('MP: tanya tim');
    expect(c).toContain('JANGAN pernah menyebutkan atau menghitung harga pengguna akhir');
    expect(c).toMatch(/PPN/);
  });
});

describe('Kebijakan Diskon Reseller', () => {
  const content = (): string => section('Kebijakan Diskon Reseller');

  // The owner's call, 2026-08-26: the discount is an entitlement, not a concession. An earlier
  // draft gated it behind the customer complaining about price, which meant a qualifying
  // 38-lusin order closed at full price without the 5% ever being mentioned.
  it('applies on a qualifying total without waiting to be asked', () => {
    const c = content();
    expect(c).toContain('tanpa menunggu customer bertanya, menawar, atau bilang mahal');
    expect(c).toContain('bukan konsesi yang harus dia minta');
    // No trigger language left anywhere, here or in the two rules that defer to this one.
    for (const s of [c, section('Kebijakan Harga'), section('Kebijakan Reseller/Agen')]) {
      expect(s).not.toMatch(/setelah\s+(pemicu|customer sendiri (mengeluh|bilang))/i);
    }
  });

  it('never applies to end users or project buyers', () => {
    const c = content();
    expect(c).toContain('Pengguna akhir dan pembeli proyek TIDAK PERNAH masuk ke sini');
    // The old rule must survive intact in its own section, or bulk end-user orders drift.
    expect(section('Kebijakan Harga')).toContain('Jumlah besar TIDAK mengubah harga');
  });

  it('carries the three thresholds, highest-tier-wins, and nothing else', () => {
    const c = content();
    expect(c).toContain('29,5jt → 15%');
    expect(c).toContain('11,2jt → 10%');
    expect(c).toContain('5,3jt → 5%');
    expect(c).toContain('Ambil tingkat TERTINGGI');
  });

  // The owner's constraint: the rule behind the thresholds is not shareable. Collapsing it to
  // three minimums means it is not in the prompt at all — so assert no trace of it leaked in.
  it('states thresholds only, never the rule that produced them', () => {
    const c = content();
    expect(c).toContain('JANGAN pernah menjelaskan DASAR atau CARA perhitungan');
    expect(c).not.toMatch(/setelah\s+(potong|diskon).{0,40}(tetap|masih)\s*(di\s*atas|>)/i);
  });

  // verifyReplyPrices (replyChecks.ts) accepts a Rp figure only if it is in the catalog block or
  // an exact multiple/pack-division of one. A discounted or summed total is neither, so writing
  // one out in full escalates the turn. The "jt/rb" shorthand carries no matching Rp figure.
  it('allows a single-product discounted total, keeps tier thresholds in shorthand', () => {
    const c = content();
    // replyChecks reconstructs base x (1 - rate), so a single-product discounted total now
    // clears the floor. Tier thresholds do not - they are not derived from a catalog figure.
    expect(c).toContain('Nominal setelah diskon HANYA boleh ditulis');
    expect(c).toContain('JANGAN ditulis sebagai angka rupiah lengkap');
    // Live 2026-08-26: a real 38-lusin x Rp 200.000 = Rp 7.600.000 quote. That multiple IS
    // allowed (Kebijakan Harga, and verifyReplyPrices accepts integer multiples), so the ban
    // has to land on mixed carts only — those are the sums the price floor actually rejects.
    expect(c).toContain('JANGAN menjumlahkan beberapa produk BERBEDA menjadi satu total');
    expect(c).toContain('total satu produk yang kamu hitung sendiri dari harga x jumlah');
  });

  // Same precedence convention as the store gate: a carve-out stated in only one of two
  // colliding rules loses about half the time.
  it('states its percent carve-out in both rules that ban percentages', () => {
    expect(content()).toContain('SATU-SATUNYA angka persen yang boleh kamu sebutkan');
    expect(section('Kebijakan Harga')).toContain('SATU-SATUNYA pengecualian adalah persentase diskon volume reseller');
    expect(section('Kebijakan Reseller/Agen')).toContain('KECUALI persentase diskon volume sesuai Kebijakan Diskon Reseller');
  });
});

describe('Playbook claims that need the catalog to back them', () => {
  it('states padlocks are Blossom only and Legacy is its official partner', () => {
    // The catalog side of this claim is asserted in catalog-claims.test.ts.
    const playbook = section('Playbook Rekomendasi per Kategori');
    expect(playbook).toContain('HANYA menyediakan satu merek, yaitu BLOSSOM');
    expect(playbook).toContain('partner resmi BLOSSOM di Indonesia');
  });

  it('sends a cheap-handle request to Aomori Slim without shrinking the size', () => {
    const playbook = section('Playbook Rekomendasi per Kategori');
    expect(playbook).toContain('HANDLE MURAH / TERJANGKAU');
    // The rule must name Aomori Slim and include the BESAR class — exact product naming is
    // the catalog block's job, so don't pin the full variant string here.
    expect(playbook).toContain('Aomori Slim');
    expect(playbook).toMatch(/HANDLE BESAR/);
    expect(playbook).toContain('jangan turunkan ukurannya');
  });
});

describe('Rules', () => {
  it('asks the buyer-type question with all three options', () => {
    const rules = section('Rules');
    expect(rules).toContain('dipakai sendiri (retail), untuk proyek, atau dijual lagi (reseller)');
  });
});

describe('reseed-prompt-defaults.ts', () => {
  // The lists moved to src/domain/promptSync.ts so they can be imported: the script itself still
  // runs its DB patch on import (dotenv, top-level await, process.exit), which is why this used to
  // scrape the file as text.

  it('syncs every section the pricing policy lives in', () => {
    for (const name of ['Kebijakan Harga', 'Kebijakan Diskon Reseller', 'Rules', 'Playbook Rekomendasi per Kategori', 'Kebijakan Reseller/Agen', 'Escalation']) {
      expect(SECTIONS_TO_SYNC, `"${name}" is edited but never synced to live phone numbers`).toContain(name);
    }
  });

  it('only names sections that exist, or the script aborts at runtime', () => {
    const known = SYSTEM_PROMPT_SECTIONS.map((s) => s.name);
    expect(SECTIONS_TO_SYNC.length).toBeGreaterThan(0);
    for (const name of SECTIONS_TO_SYNC) expect(known).toContain(name);
  });
});

// UAT 2026-09-22..24. Each rule below was broken live; the deterministic checks in replyChecks.ts
// catch the price-shaped half, these keep the instruction itself from being edited away.
describe('UAT 2026-09 rules stay in the prompt', () => {
  it('Kebijakan Harga: one unlabelled figure, never a pair to choose from, haggling goes to the team', () => {
    const c = section('Kebijakan Harga');
    expect(c).toContain('Sebut SATU angka untuk satu varian, tanpa label');
    expect(c).toContain('"Rp X untuk reseller, Rp Y untuk dipakai sendiri"');
    expect(c).toMatch(/kemahalan[\s\S]{0,120}confidence "low"/);
  });

  it('Escalation: a plain stock question is answered, not handed off', () => {
    const c = section('Escalation');
    expect(c).toContain('BUKAN untuk pertanyaan "ada?" / "ready?" biasa');
    expect(c).toContain('JANGAN menawarkan produk pengganti');
    expect(c).toMatch(/11\. Customer menanyakan hal di luar produk: lowongan kerja/);
  });

  // UAT Run 2 F-09: after any hand-off the old last bullet ("cukup informasikan bahwa permintaannya
  // sedang diproses") made the model return "low" for every later sales question, so each one got
  // "Baik kak, semuanya sudah saya catat ya." and nobody could get a price.
  it('Escalation: a hand-off does not stop the bot answering, except chasers and the locked pricelist', () => {
    const c = section('Escalation');
    expect(c).not.toContain('cukup informasikan bahwa permintaannya sedang diproses');
    expect(c).toContain('Hand-off hanya MEMBERI TAHU tim; kamu tetap melayani');
    expect(c).toMatch(/termasuk tentang produk yang sedang dicek tim\) → jawab seperti biasa dengan confidence "high"/);
    expect(c).toContain('harga pricelist yang dikunci Kebijakan Harga');
    expect(c).toMatch(/"jadi gimana\?"[\s\S]{0,120}confidence "low" dan message kosong/);
  });

  it('Decision Principles: the team closes the order, the bot does not collect address or payment', () => {
    expect(section('Decision Principles')).toContain('JANGAN meminta alamat, nomor HP, atau pembayaran');
    expect(section('Scope')).not.toContain('checkout');
  });

  it('Scope: one fixed disclosure line, and no "Customer Service AI" self-description', () => {
    const c = section('Scope');
    expect(c).toContain('"Aku asisten virtual Legacy kak 😊 Kalau mau ngobrol langsung sama tim juga bisa ya."');
    expect(c).not.toContain('Customer Service AI');
  });

  // UAT Run 2 A-01/A-03/A-04/A-05: the reply to the customer's name was "Ada yang bisa saya bantu
  // carikan hari ini?" - the very phrase Tone offered as the "natural" form. The name is still followed
  // by the buyer type. But a greeting with no need stated now gets exactly that open question (client,
  // 2026-11-02): a plastics factory greeted "salam kenal saya Windy dari PT ..." was asked "dipakai
  // sendiri, untuk proyek, atau dijual lagi?" before it said it had come to sell to us.
  it('Rules/Tone: a greeting with no need gets "ada yang bisa saya bantu?", the name is followed by the buyer type', () => {
    expect(section('Tone')).not.toContain('"ada yang bisa saya bantu carikan?"');
    const rules = section('Rules');
    expect(rules).toContain('"Haloo kak, salam kenal saya Rina dari Legacy 😊 Ada yang bisa saya bantu kak?"');
    expect(rules).toContain('Pada balasan ini JANGAN menanyakan nama dan JANGAN menanyakan tipe pembeli');
    expect(rules).toContain('"halo siang, dg legacy?"');
    expect(rules).toContain('Contoh balasan tepat setelah customer menjawab pertanyaan nama');
    expect(rules).toContain('JANGAN menanyakan tipe pembeli sebelum nama pernah ditanyakan');
  });

  it('Escalation: a factory offering us its goods is a hand-off even without the word supplier', () => {
    const c = section('Escalation');
    expect(c).toContain('Termasuk pabrik atau supplier yang menawarkan barangnya KEPADA kami');
    expect(c).toContain('JANGAN menanyakan tipe pembeli atau jumlah kebutuhan');
  });

  // UAT G-04, Run 1 and Run 2: "pikir-pikir dulu ya kak" got a polite goodbye both times - the
  // rule existed, with no example of the reply it wanted.
  it('Decision Principles: "pikir-pikir dulu" is answered with one probing question, shown by example', () => {
    const c = section('Decision Principles');
    expect(c).toContain('Contoh balasan untuk "pikir-pikir dulu ya kak"');
    expect(c).toContain('Boleh tahu yang masih dipertimbangkan apa');
  });

  // UAT C-04, Run 1 and Run 2: 3 karton got the right 5% but never the nudge to 10% - the buy-intent
  // rule ("berhenti menjual") took over the reply and the discount rule's nudge fell off.
  it('Decision Principles: a reseller\'s order confirmation still nudges to the next discount tier', () => {
    const c = section('Decision Principles');
    expect(c).toContain('tidak menghapus hak diskon RESELLER');
    expect(c).toContain('Kalau totalnya bisa sampai sekitar 11,2jt, diskonnya naik jadi 10% kak.');
    // The replay still confirmed "3 karton" with no discount at all until the discount section said it too.
    expect(section('Kebijakan Diskon Reseller')).toContain('Termasuk saat reseller langsung memesan');
  });

  // UAT Run 2 C-03: a Surabaya reseller was never invited to the showroom, and a maps link to a
  // housing cluster opened the pricelist with no store name at all.
  it('Reseller: Surabaya gets the showroom invitation; a housing link is not a store name', () => {
    expect(section('Kebijakan Reseller/Agen')).toContain('undang SEKALI ke showroom');
    const c = section('Kebijakan Harga');
    expect(c).toContain('Gerbang ini butuh NAMA TOKO');
    expect(c).toContain('itu belum nama toko');
    // ...and the "clearly not a shop -> escalate" rule no longer lists a home as its example.
    expect(c).not.toContain('rumah tinggal)');
  });

  // UAT Run 2 D-06 / B-02: "BNSN (Brass Nickel Silver Nickel)", "SNCP (Silver Nickel Chrome
  // Plated)", and "Black Silver (BNSN)" - the last one made the judge reject a project buyer's price.
  it('Product Recommendation Format: colour codes exactly as in the catalog, never glossed', () => {
    const c = section('Product Recommendation Format');
    expect(c).toContain('ditulis PERSIS seperti di katalog');
    expect(c).toContain('JANGAN mencocokkan sendiri warna yang disebut customer');
    // Replay of B-02: the model echoed the customer's "black silver" as a colour in every draft.
    expect(c).toContain('Kata warna customer itu juga JANGAN ditulis ulang sebagai nama warna/varian');
  });

  it('Tone: English in, English out', () => {
    expect(section('Tone')).toContain('menulis dalam bahasa Inggris, jawab dalam bahasa Inggris');
  });

  it('Playbook: only ready variants are options', () => {
    expect(section('Playbook Rekomendasi per Kategori')).toContain('READY (varian tanpa tanda [STOK HABIS SEMENTARA])');
  });

  // UAT Run 3 D-03: "BC9030 lagi kosong, coba saya tanyakan ke tim kapan stoknya datang" - with
  // BC9025 25MM ready at Rp 56.000. The old rule let "confirm with the team" stand in for an option.
  // UAT Run 3 C-03: invited to the showroom with the address, but without the maps link.
  it('Kebijakan Reseller/Agen: the showroom invite writes the maps link out', () => {
    const c = section('Kebijakan Reseller/Agen');
    expect(c).toContain('https://maps.app.goo.gl/VQpJ61Ar3BrtBTFNA');
    expect(c).toContain('Link-nya WAJIB ditulis lengkap di undangan itu');
  });

  it('Playbook: out of stock is answered with the nearest ready variant, not the team', () => {
    const c = section('Playbook Rekomendasi per Kategori');
    expect(c).toContain('LANGSUNG tawarkan varian ready yang paling dekat');
    expect(c).not.toContain('atau sampaikan bahwa ketersediaannya akan dikonfirmasi ke tim');
  });

  it('Product Recommendation Format: the example no longer prints pricelist figures as if for anyone', () => {
    const c = section('Product Recommendation Format');
    expect(c).not.toContain('Rp 32.000 / Rp 42.000 / Rp 52.000');
    expect(c).toContain('Contoh untuk pembeli pengguna akhir');
  });

  it('behavioral rules: no talk about its own instructions, links are ordinary messages, photos point at the store', () => {
    expect(SYSTEM_PROMPT_BEHAVIORAL_RULES).toContain('Wah, itu nggak bisa aku bagikan ya kak');
    expect(SYSTEM_PROMPT_BEHAVIORAL_RULES).toContain('Link-nya untuk apa ya kak?');
    expect(SYSTEM_PROMPT_BEHAVIORAL_RULES).toContain(END_USER_CATALOG_URL);
    expect(SYSTEM_PROMPT_BEHAVIORAL_RULES).not.toContain('SATU katalog produk Legacy');
  });

  // replyChecks enforces the tiers this section states (UAT Run 3 C-04: 5% on Rp 2.055.000). A floor
  // moved in one place only would reject correct discounts or pass wrong ones.
  it('Kebijakan Diskon Reseller states exactly the floors replyChecks enforces', () => {
    for (const t of DISCOUNT_TIERS) {
      expect(section('Kebijakan Diskon Reseller')).toContain(`Total di atas ${t.label} → ${Math.round(t.rate * 100)}%`);
    }
  });

  // UAT Run 3 H-06: "ini bot ya? atau orang?" in an escalated chat got the hand-off ack - the model
  // read it as rule 8. D-08: every BODY PELOR is out of stock, and the model read that as "no
  // relevant product", returned low, and the customer got an ack instead of "kosong" + an option.
  it('Escalation: asking whether it is a bot is not asking for a person', () => {
    expect(section('Escalation')).toContain('Pertanyaan apakah kamu bot atau orang');
  });

  it('an out-of-stock product is still relevant - answered, not handed off', () => {
    expect(SYSTEM_PROMPT_BEHAVIORAL_RULES).toContain('stoknya sedang habis TETAP relevan');
  });

  // UAT Run 3 D-10: "doorpull kami ... cocok untuk pintu kaca frameless" named no product.
  it('behavioral rules bind fit claims about a product TYPE to the data too', () => {
    expect(SYSTEM_PROMPT_BEHAVIORAL_RULES).toContain('JENIS produk tanpa nama produknya');
  });

  // Replies go out through the respond_to_customer tool. A "reply in this JSON format" contract
  // here made the model write `message` as a JSON string, down to the next tool parameter (UAT Run 3 F-29).
  it('behavioral rules carry no JSON output contract', () => {
    expect(SYSTEM_PROMPT_BEHAVIORAL_RULES).not.toMatch(/format JSON|"message"\s*:|"confidence"\s*:/);
    expect(SYSTEM_PROMPT_BEHAVIORAL_RULES).toContain('lewat tool respond_to_customer');
  });

  it('syncs every section these rules were added to', () => {
    for (const name of ['Kebijakan Harga', 'Escalation', 'Decision Principles', 'Scope', 'Tone', 'Rules', 'Playbook Rekomendasi per Kategori', 'Product Recommendation Format', 'Kebijakan Reseller/Agen']) {
      expect(SECTIONS_TO_SYNC, `"${name}" is edited but never synced to live phone numbers`).toContain(name);
    }
  });
});
