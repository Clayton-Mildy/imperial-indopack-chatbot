/**
 * reply-checks.test.ts
 * The deterministic price floor-check: catches misquoted prices (transposed digits, invented
 * figures) the LLM fit judge cannot reliably catch. Pure — no DATABASE_URL, no API key.
 */

import { describe, it, expect } from 'vitest';
import { withoutInventedTotals, verifyReplyPrices, verifyReplyPacks, verifyReplyDiscount, verifyReplyTone, verifyReplyNotCarried, verifyReplyPhotoClaim, verifyReplyTier, verifyReplyMeta, verifyReplyCatalogClaim, verifyReplyOpener, verifyReplyFirstGreeting, verifyReplyNameRepeat, verifyReplyNotCarriedCloses, nameGivenIn, ASKS_NAME_RE } from '../src/services/replyChecks.js';
import { SYSTEM_PROMPT_BEHAVIORAL_RULES } from '../src/domain/constants.js';

const CATALOG = `
Produk: DOORPULL PERTH VINTAGE BLUE
Varian:
  - BLACK CHROME - 36CM: Rp 105.000/Set
  - SILVER CHROME - 36CM: Rp 105.000/Set

Produk: ENGSEL STAINLESS STEEL SILVER VINTAGE
Varian:
  - 4": Rp42.000/Set
`;

describe('withoutInventedTotals', () => {
  it('cuts total lines and a total section, keeping the item prices', () => {
    const msg = [
      'Engsel 4": Rp 42.000/Set',
      'Doorpull: Rp 105.000/Set',
      '',
      '**TOTAL PER RUMAH:**',
      '- Pintu kembar: Rp 520.000',
      '- Jendela: Rp 150.500',
      '',
      'Grand total 100 rumah: Rp 67.050.000',
      '---',
    ].join('\n');
    expect(withoutInventedTotals(msg, [520000, 150500, 67050000])).toBe('Engsel 4": Rp 42.000/Set\nDoorpull: Rp 105.000/Set');
  });

  it('refuses a misquoted price that is not a total', () => {
    expect(withoutInventedTotals('Engsel 4": Rp 41.000/Set\nTotal: Rp 82.000', [41000, 82000])).toBeNull();
  });
});

// Owner, 2026-10-27: "sometimes we order 3 items from the bot - when it can see the prices it should
// total them". A total used to fail like an invented price: it is neither a catalog price nor a
// multiple of one. Now its arithmetic is checked against the reply's own item lines.
describe('verifyReplyPrices - totals', () => {
  it('passes a total that is the sum of the items above it', () => {
    // 189.000 is no whole multiple of either price (378.000 = 9 x 42.000 would pass on that alone).
    const msg = 'Doorpull 1 x Rp 105.000 = Rp 105.000\nEngsel 4": 2 x Rp 42.000 = Rp 84.000\nTotal: Rp 189.000';
    expect(verifyReplyPrices(msg, CATALOG).ok).toBe(true);
  });

  it('passes a total over single items, and a stated multiple of it', () => {
    const msg = 'Doorpull Rp 105.000/Set\nEngsel 4" Rp 42.000/Set\nTotal 1 unit: Rp 147.000\nTotal 3 unit: Rp 441.000';
    expect(verifyReplyPrices(msg, CATALOG).ok).toBe(true);
  });

  it('passes subtotals and a grand total of them', () => {
    const msg = [
      'Pintu depan: Doorpull Rp 105.000/Set', 'Subtotal: Rp 105.000', '',
      'Pintu kamar: Engsel 4" 2 x Rp 42.000 = Rp 84.000', 'Subtotal: Rp 84.000', '',
      'Grand total: Rp 189.000',
    ].join('\n');
    expect(verifyReplyPrices(msg, CATALOG).ok).toBe(true);
  });

  // Replay 2026-10-27: a correct Rp 738.000 was rejected because the reply also restated a unit price
  // on a line of its own ("Harganya Rp 210.000/Set"), which was counted as one more item.
  it('passes a total of the computed lines when unit prices are also restated on their own', () => {
    const msg = 'Doorpull: harganya Rp 105.000/Set\n1 x Rp 105.000 = Rp 105.000\nEngsel 4": 2 x Rp 42.000 = Rp 84.000\nTotal: Rp 189.000';
    expect(verifyReplyPrices(msg, CATALOG).ok).toBe(true);
  });

  it('fails a total that does not add up, naming it', () => {
    const out = verifyReplyPrices('Doorpull Rp 105.000/Set\nEngsel 4" Rp 42.000/Set\nTotal: Rp 150.000', CATALOG);
    expect(out.ok).toBe(false);
    expect(out.invented).toEqual([150000]);
  });

  it('does not take a sum for a price on a line that is not a total', () => {
    expect(verifyReplyPrices('Doorpull Rp 105.000/Set\nEngsel 4" Rp 42.000/Set\nPaket keduanya Rp 147.000', CATALOG).ok).toBe(false);
  });
});

describe('verifyReplyPrices', () => {
  it('passes a single price that is in the catalog', () => {
    expect(verifyReplyPrices('DOORPULL PERTH ini Rp 105.000/Set kak.', CATALOG)).toEqual({ ok: true, reason: '' });
  });

  it('passes multiple valid prices', () => {
    const msg = 'DOORPULL Rp 105.000/Set, ENGSELnya Rp42.000/Set.';
    expect(verifyReplyPrices(msg, CATALOG)).toEqual({ ok: true, reason: '' });
  });

  it('fails a transposed-digit price', () => {
    const out = verifyReplyPrices('Harganya Rp 105.300/Set kak.', CATALOG);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('Harga Rp 105.300 tidak ada di katalog.');
  });

  it('fails an invented price', () => {
    const out = verifyReplyPrices('Harganya Rp 999.000 ya kak.', CATALOG);
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('Rp 999.000');
  });

  it('passes an exact 5x total', () => {
    expect(verifyReplyPrices('5 set = Rp 525.000 ya kak.', CATALOG)).toEqual({ ok: true, reason: '' });
  });

  it('ignores sub-1000 figures', () => {
    // "Rp 5" is not a real price (stray fragment) — it must never even reach the offender list.
    expect(verifyReplyPrices('Ready Rp 5 pcs kak.', CATALOG)).toEqual({ ok: true, reason: '' });
  });

  it('parses "Rp 105.000/Set" and "Rp105.000" formatting variants alike', () => {
    expect(verifyReplyPrices('Rp 105.000/Set', CATALOG).ok).toBe(true);
    expect(verifyReplyPrices('Rp105.000', CATALOG).ok).toBe(true);
  });

  it('passes a message with no Rp figures at all', () => {
    expect(verifyReplyPrices('Boleh kak, ada beberapa pilihan warna.', CATALOG)).toEqual({ ok: true, reason: '' });
  });

  it('passes an empty message', () => {
    expect(verifyReplyPrices('', CATALOG)).toEqual({ ok: true, reason: '' });
  });
});

// The catalog block now carries a retail figure beside each pricelist figure. These are the
// cases that decide whether the retail policy is enforceable at all: a rendered retail price
// must pass, a model-computed one must not, and Shind — which renders no retail figure — must
// reject anything the model makes up for it.
describe('verifyReplyPrices — product codes ending in RP are not prices', () => {
  // Live 2026-10-05: a project buyer listed "handle pintu aloma LRP 8161/ HRP 8161i". The case-
  // insensitive /Rp\s*\d/ matched the "RP 8161" inside both codes, read it as Rp 8.161, and the
  // reply naming the product was escalated as "Harga Rp 8.161 tidak ada di katalog".
  it('does not read the RP inside LRP 8161 / HRP 8161i as Rp 8.161', () => {
    expect(verifyReplyPrices('Handle pintu Aloma LRP 8161 / HRP 8161i kami cek stoknya ya kak.', CATALOG))
      .toEqual({ ok: true, reason: '' });
  });

  it('still reads a real price right next to such a code', () => {
    const r = verifyReplyPrices('LRP 8161 harganya Rp 8.161 kak.', CATALOG);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('Rp 8.161');
  });
});

describe('verifyReplyPrices — MP (end-user) prices', () => {
  const TWO_PRICE = `
Merek: Aomori Slim
Produk: HANDLE BESAR + BODY AOMORI SLIM MANCHESTER (7007)
Varian:
  - BLACK SILVER - 25CM X 5CM: Rp 125.000/Set | MP: Rp 175.000/Set

Merek: Shind [Merek Distribusi]
Produk: TANG KOMBINASI SHIND
Varian:
  - 8": Rp 45.000/Pcs | MP: tanya tim
`;

  it('passes the rendered MP figure', () => {
    expect(verifyReplyPrices('Harganya Rp 175.000/Set ya kak.', TWO_PRICE).ok).toBe(true);
  });

  it('still passes the pricelist figure — tier choice is not this check’s job', () => {
    expect(verifyReplyPrices('Harganya Rp 125.000/Set ya kak.', TWO_PRICE).ok).toBe(true);
  });

  it('passes a total built from the MP figure', () => {
    expect(verifyReplyPrices('3 set = Rp 525.000 ya kak.', TWO_PRICE).ok).toBe(true);
  });

  it('rejects a markup the model computed itself instead of reading', () => {
    // A model applying +30% to Shind's 45.000 lands on 58.500, which is in no catalog line.
    const out = verifyReplyPrices('Harga retailnya Rp 58.500/Pcs kak.', TWO_PRICE);
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('Rp 58.500');
  });

  it('rejects an invented figure for a variant with no MP, because none is rendered', () => {
    // The hand-off is data-driven now: "tanya tim" carries no digits, so nothing to quote.
    expect(verifyReplyPrices('Untuk retail Rp 60.000/Pcs kak.', TWO_PRICE).ok).toBe(false);
    expect(verifyReplyPrices('Untuk retail Rp 55.000/Pcs kak.', TWO_PRICE).ok).toBe(false);
  });
});

describe('verifyReplyPrices — the pricelist must not reach an end user', () => {
  // Live 2026-09-21: a customer said "saya mau untuk dipakai sendiri" and was quoted BETEL TOPI
  // LANCIP at Rp 96.000 - the reseller pricelist - instead of its Rp 101.000 MP. Every other
  // rule here accepts both figures, because both are genuinely printed in the block; only the
  // resolved buyer type can tell them apart.
  const BLOCK = `
Merek: Shind
Produk: BETEL TOPI LANCIP
Varian:
  - UK 10": Rp 96.000/Pcs | MP: Rp 101.000/Pcs
  - UK 12": Rp 107.500/Pcs | MP: Rp 113.000/Pcs
`;

  it('rejects the pricelist figure when the customer is an end user', () => {
    const out = verifyReplyPrices('Harganya Rp 96.000/Pcs kak.', BLOCK, BLOCK, 'end_user');
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('PRICELIST');
  });

  it('accepts the MP figure for the same customer', () => {
    expect(verifyReplyPrices('Harganya Rp 101.000/Pcs kak.', BLOCK, BLOCK, 'end_user').ok).toBe(true);
  });

  it('leaves resellers and project buyers alone - the pricelist is theirs', () => {
    expect(verifyReplyPrices('Harganya Rp 96.000/Pcs kak.', BLOCK, BLOCK, 'reseller').ok).toBe(true);
    expect(verifyReplyPrices('Harganya Rp 96.000/Pcs kak.', BLOCK, BLOCK, 'project').ok).toBe(true);
    // An unknown buyer type is not this function's case: verifyReplyTier refuses EVERY figure then.
    expect(verifyReplyPrices('Harganya Rp 96.000/Pcs kak.', BLOCK, BLOCK, null).ok).toBe(true);
  });

  it('still accepts a figure that is some other variant\'s MP', () => {
    // Two products can legitimately share a number; a false rejection costs a repair round.
    const shared = BLOCK + '\nProduk: LAIN\nVarian:\n  - A: Rp 200.000/Pcs | MP: Rp 96.000/Pcs\n';
    expect(verifyReplyPrices('Rp 96.000 kak.', shared, shared, 'end_user').ok).toBe(true);
  });

  it('does not fire when a variant has no separate MP', () => {
    const same = 'Varian:\n  - UK 1": Rp 50.000/Pcs | MP: Rp 50.000/Pcs\n';
    expect(verifyReplyPrices('Rp 50.000 kak.', same, same, 'end_user').ok).toBe(true);
  });
});

describe('verifyReplyPrices — whole packs at pricelist, remainder at MP', () => {
  // The rendered shape: pricelist is per lusin, MP is per piece, on one line.
  const PACK = `
Merek: Aomori
Produk: ENGSEL TIPIS STAINLESS STEEL
Varian:
  - UK 2": Rp 46.000/Lsn | MP: Rp 5.500/Pcs | CTN: 50 Lsn
  - UK 3": Rp 77.000/Lsn | MP: Rp 9.000/Pcs | CTN: 20 Lsn
`;

  it('passes 1 lusin + 5 pcs', () => {
    // 46.000 + 5 x 5.500 = 73.500 — not a multiple or division of either figure.
    expect(verifyReplyPrices('Totalnya Rp 73.500 kak.', PACK).ok).toBe(true);
  });

  it('passes 2 lusin + 3 pcs', () => {
    expect(verifyReplyPrices('Jadi Rp 108.500 ya kak.', PACK).ok).toBe(true);
  });

  it('keeps pairing within one variant', () => {
    // 46.000 (UK 2") + 2 x 9.000 (UK 3") = 64.000. Mixing two variants is a cart, not this rule.
    expect(verifyReplyPrices('Totalnya Rp 64.000 kak.', PACK).ok).toBe(false);
  });

  it('still rejects a figure one rupiah off a real remainder total', () => {
    const out = verifyReplyPrices('Totalnya Rp 73.499 kak.', PACK);
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('Rp 73.499');
  });

  it('does not let the new rule wave through an ordinary transposed digit', () => {
    expect(verifyReplyPrices('Harganya Rp 64.500/Lsn kak.', PACK).ok).toBe(false);
  });
});

describe('verifyReplyPrices — derived unit prices', () => {
  const block = 'Varian:\n  - LUSIN: Rp 475.000/Lusin\n  - SET: Rp 105.000/Set\n';

  it('accepts a per-pcs price honestly derived from a pack price (rounded to rupiah)', () => {
    // 475.000 / 12 = 39.583,33 → the bot quotes Rp 39.583/pcs (TC-16's expectation).
    expect(verifyReplyPrices('Per pcs jatuhnya Rp 39.583 ya kak', block).ok).toBe(true);
  });

  it('still rejects a transposed digit that no division produces', () => {
    expect(verifyReplyPrices('Harganya Rp 105.300/Set kak', block).ok).toBe(false);
  });
});

describe('verifyReplyPrices — a figure printed in the catalog is never "invented"', () => {
  // Live 2026-09-09: "Engsel jendela sm grendel jendela". The reply quoted GRENDEL BULAT's own
  // Rp 42.500 / Rp 50.000, but the name matcher only recognised the engsel (every word of
  // "GRENDEL BULAT STAINLESS STEEL" is too common to identify it once the model shortens the
  // name), so the price scope held the engsel alone and both real prices read as invented.
  const scope = 'Produk: ENGSEL SALON STAINLESS STEEL\nVarian:\n  - UK 9" 1.8MM: Rp 327.500/Lsn | RETAIL: Rp 425.750/Lsn\n';
  const full = `${scope}\nProduk: GRENDEL BULAT STAINLESS STEEL\nVarian:\n  - UK 1 1/2": Rp 42.500/Lsn | RETAIL: Rp 55.250/Lsn\n  - UK 2": Rp 50.000/Lsn | RETAIL: Rp 65.000/Lsn\n`;

  it('accepts a real catalog price the narrowed scope happens to miss', () => {
    const msg = 'Engsel salon Rp 327.500/Lsn, grendel bulat Rp 42.500 dan Rp 50.000/Lsn kak.';
    expect(verifyReplyPrices(msg, scope, full)).toEqual({ ok: true, reason: '' });
  });

  it('still rejects a transposed digit that is nowhere in the catalog', () => {
    const out = verifyReplyPrices('Grendelnya Rp 42.800/Lsn kak.', scope, full);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('Harga Rp 42.800 tidak ada di katalog.');
  });

  it('keeps ARITHMETIC narrow: a multiple of an out-of-scope price is still rejected', () => {
    // 3 x 42.500 = 127.500 is not printed anywhere, and 42.500 is not in scope - so the
    // exemption must not extend to figures merely derived from an unnamed product.
    expect(verifyReplyPrices('3 Lsn jadi Rp 127.500 kak.', scope, full).ok).toBe(false);
  });

  it('defaults to the same block when no wider catalog is passed', () => {
    expect(verifyReplyPrices('Grendel Rp 42.500 kak.', scope).ok).toBe(false);
  });
});

describe('verifyReplyPrices — bulk totals the prompt tells the model to compute', () => {
  // MAX_MULTIPLE was 100, below the quantities this business actually sees: the Pak Hendra
  // reference is 272 pcs and TC-30 is a 500-set project order. Both had a CORRECT total rejected
  // as invented, repaired once, then escalated.
  const block = 'Varian:\n  - 4": Rp 42.000/Set | RETAIL: Rp 54.600/Set\n';

  it.each([
    [272, 11_424_000],
    [500, 21_000_000],
  ])('accepts %i units = Rp %i', (qty, total) => {
    const msg = `Untuk ${qty} set, totalnya Rp ${total.toLocaleString('id-ID')} kak.`;
    expect(verifyReplyPrices(msg, block, block).ok).toBe(true);
  });

  it('still rejects a total that is not a whole multiple of any catalog price', () => {
    expect(verifyReplyPrices('Totalnya Rp 11.424.999 kak.', block, block).ok).toBe(false);
  });
});

describe('verifyReplyPrices — reseller volume discounts', () => {
  // Live 2026-08-26: 38 lusin x Rp 200.000 = Rp 7.600.000, less 5% = Rp 7.220.000. The base
  // total passed as an integer multiple; the discounted one was rejected as invented, which is
  // what stopped the bot from ever stating a discount figure.
  const block = 'Varian:\n  - CETOK SEMEN OVAL UK 6": Rp 200.000/Lusin\n';

  it('accepts a discounted total when the reply is about a discount', () => {
    expect(verifyReplyPrices('Total 38 Lsn Rp 7.600.000, diskon 5% jadi Rp 7.220.000 kak', block).ok).toBe(true);
  });

  it('accepts the live "Budget 11 jt" case: 55 lusin, 5%, Rp 10.450.000', () => {
    // Sandbox 2026-08-26. 11jt sits between the 5% floor (>5.263.158) and the 10% floor
    // (>11.111.112), so it is a 5% order - and the discounted total has to clear the floor
    // or the reply is repaired and escalated instead of sent.
    const reply = '55 lusin totalnya Rp 11.000.000, diskon 5% jadi Rp 10.450.000 kak';
    expect(verifyReplyPrices(reply, block).ok).toBe(true);
  });

  it('accepts all three rates, each off a total that clears its floor', () => {
    expect(verifyReplyPrices('60 Lsn Rp 12.000.000, diskon 10% jadi Rp 10.800.000', block).ok).toBe(true);
    expect(verifyReplyPrices('150 Lsn Rp 30.000.000, diskon 15% jadi Rp 25.500.000', block).ok).toBe(true);
  });

  it('accepts the discount itself as a figure (UAT Run 2 C-04: "Rp 6.165.000 - Rp 308.250")', () => {
    const aomori = 'Varian:\n  - UK 2 1/2": Rp 68.500/Lsn | MP: Rp 8.000/Pcs | 1 karton = 30 Lsn\n';
    const run2 = '3 Karton (1 karton = 30 Lsn = 360 pcs) • Harga: Rp 68.500/Lsn × 90 Lsn = Rp 6.165.000 • Diskon 5% (total di atas 5,3jt): Rp 6.165.000 - Rp 308.250 = *Rp 5.856.750*';
    expect(verifyReplyPrices(run2, aomori)).toEqual({ ok: true, reason: '' });
  });

  it('rejects a tier whose floor the total does not clear (UAT Run 3 C-04: 5% on Rp 2.055.000)', () => {
    const r = verifyReplyPrices('3 karton = 30 Lusin x Rp 68.500 = Rp 2.055.000 • Diskon 5% (total di atas 5,3jt) jadi Rp 1.952.250',
      'Varian:\n  - UK 2 1/2": Rp 68.500/Lsn | MP: Rp 8.000/Pcs | 1 karton = 30 Lsn\n');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('5,3jt');
  });

  it('rejects a lower tier once the total is past the next floor', () => {
    const r = verifyReplyPrices('60 Lsn Rp 12.000.000, diskon 5% jadi Rp 11.400.000', block);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('10%');
  });

  it('rejects a rate we do not offer, and a discount off a total the reply never states', () => {
    // Rp 6.080.000 is 20% off 38 lusin, and also 5% off 32 lusin - a total nobody quoted.
    expect(verifyReplyPrices('diskon 20% jadi Rp 6.080.000', block).ok).toBe(false);
    expect(verifyReplyPrices('38 Lsn Rp 7.600.000, diskon 20% jadi Rp 6.080.000', block).ok).toBe(false);
  });

  it('does not widen the floor for a reply with no discount in it', () => {
    // Same figure, no discount context: this must stay an invented price.
    expect(verifyReplyPrices('Totalnya Rp 7.220.000 kak', block).ok).toBe(false);
  });

  it('still catches a transposed digit inside a discount reply', () => {
    // 7.220.000 mistyped as 7.202.000 — no base/rate combination produces it.
    expect(verifyReplyPrices('diskon 5% jadi Rp 7.202.000', block).ok).toBe(false);
  });
});

describe('verifyReplyPacks — "N karton = M" against the catalog line', () => {
  // formatProducts' rendering of ENGSEL TIPIS STAINLESS STEEL: out-of-stock sizes carry no pack line.
  const AOMORI = [
    'Produk: ENGSEL TIPIS STAINLESS STEEL',
    'Varian:',
    '  - UK 2" [STOK HABIS SEMENTARA]',
    '  - UK 2 1/2": Rp 68.500/Lsn | MP: Rp 8.000/Pcs | 1 karton = 30 Lsn [MIN ORDER: 1 Lsn]',
    '  - UK 3" [STOK HABIS SEMENTARA]',
  ].join('\n');
  // UAT Run 3 C-04, 13:51:30, verbatim.
  const RUN3 = 'Baik Pak Rudi, saya catat pesanannya:\n\n**ENGSEL TIPIS STAINLESS STEEL Aomori UK 2½"**\n• 3 karton = 30 Lusin x Rp 68.500 = Rp 2.055.000\n• Diskon 5% (total di atas 5,3jt) jadi Rp 1.952.250\n\nPesanan Pak Rudi sudah saya catat ya.';

  it('rejects 3 karton = 30 Lusin and names the right figure', () => {
    const r = verifyReplyPacks(RUN3, AOMORI);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('3 karton = 90 Lusin');
  });

  it.each([
    '3 karton = 90 Lsn x Rp 68.500 = Rp 6.165.000',
    '3 karton x 30 Lsn/karton = 90 Lsn',
    '3 Karton (1 karton = 30 Lsn = 360 pcs)',
    '2 karton isi 720 pcs',
  ])('accepts %s', (m) => {
    expect(verifyReplyPacks(m, AOMORI)).toEqual({ ok: true, reason: '' });
  });

  it('has nothing to say when no pack line is in scope', () => {
    expect(verifyReplyPacks('3 karton = 30 Lusin', 'Varian:\n  - UK 4": Rp 42.000/Set\n').ok).toBe(true);
  });
});

describe('verifyReplyDiscount — the reseller hears the tier, and the next one (R-11)', () => {
  const AOMORI = 'Varian:\n  - UK 2 1/2": Rp 68.500/Lsn | MP: Rp 8.000/Pcs | 1 karton = 30 Lsn\n';

  it('asks for the tier and the nudge when a confirmation over 5,3jt names neither (Run 3 replay)', () => {
    const r = verifyReplyDiscount('**ENGSEL TIPIS STAINLESS STEEL Aomori UK 2½"**\n• 3 karton = 90 Lsn x Rp 68.500 = Rp 6.165.000\n\nTim kami akan menghubungi Pak Rudi.', AOMORI, 'reseller');
    expect(r).toMatchObject({ ok: false, soft: true });
    expect(r.reason).toContain('diskon 5% (jadi Rp 5.856.750)');
    expect(r.reason).toContain('sekitar 11,2jt');
  });

  it('asks for the nudge when only the tier was named (UAT Run 2 C-04)', () => {
    const r = verifyReplyDiscount('Rp 68.500/Lsn × 90 Lsn = Rp 6.165.000 • Diskon 5%: Rp 6.165.000 - Rp 308.250 = *Rp 5.856.750*', AOMORI, 'reseller');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('11,2jt');
  });

  it.each([
    ['the full confirmation', '90 Lsn Rp 6.165.000, diskon 5% jadi Rp 5.856.750. Kalau totalnya bisa sampai sekitar 11,2jt, diskonnya naik jadi 10% kak.', 'reseller'],
    ['a total under the first floor', '30 Lsn x Rp 68.500 = Rp 2.055.000', 'reseller'],
    ['an end user, who has no tiers', '90 Lsn x Rp 68.500 = Rp 6.165.000', 'end_user'],
  ])('leaves %s alone', (_, m, type) => {
    expect(verifyReplyDiscount(m, AOMORI, type).ok).toBe(true);
  });
});

describe('verifyReplyTier — which prices a reply may talk about at all', () => {
  // UAT 2026-09-24 A-02: the FIRST reply to "berapa harga handle newton?" quoted both tiers, with
  // labels, to someone who had not said what the handle was for.
  const BOTH_TIERS = 'Handle Newton ada kak: Rp 210.000/Set (harga reseller) atau Rp 294.000/Set (harga untuk pengguna akhir).';

  it('refuses any figure while the buyer type is unknown', () => {
    const out = verifyReplyTier(BOTH_TIERS, null);
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('Tipe pembeli belum diketahui');
    expect(verifyReplyTier('Newton Rp 294.000/Set kak.', undefined).ok).toBe(false);
  });

  // "Rp." is common Indonesian spelling; without the dot allowed it was not a figure at all and
  // walked past the gate - and every other figure check.
  it('reads "Rp." with a dot as a figure too', () => {
    expect(verifyReplyTier('Newton Rp. 294.000/Set kak.', null).ok).toBe(false);
  });

  it('lets an unknown buyer hear everything except a price', () => {
    expect(verifyReplyTier('Handle Newton ada kak. Ini untuk dipakai sendiri, untuk proyek, atau dijual lagi?', null).ok).toBe(true);
    // Reseller discount thresholds are written as shorthand, never as a rupiah figure.
    expect(verifyReplyTier('Diskonnya mulai dari total 5,3jt kak.', null).ok).toBe(true);
  });

  it.each([
    ['Rp 80.000/Set (pricelist) atau Rp 112.000/Set (harga retail)', 'end_user'],
    ['Harga per set: Rp 294.000 (untuk pengguna akhir)', 'end_user'],
    ['2" GOTHIC: Rp 200.000/Lsn | MP: Rp 23.500/Pcs', 'end_user'],
    ['Rp 210.000/Set (harga pricelist untuk proyek)', 'project'],
    ['Katalog price list kami khusus untuk reseller dan proyek.', 'end_user'],
    ['Kalau mau, saya tanyakan ke tim untuk penawaran khusus ya kak.', 'end_user'],
    ['Harga retail-nya Rp 68.500/Lsn kak.', 'reseller'],
  ])('rejects tier vocabulary: %s (%s)', (msg, type) => {
    expect(verifyReplyTier(msg, type).ok).toBe(false);
  });

  it('allows "price list" in a reseller conversation, where it is trade talk', () => {
    expect(verifyReplyTier('Harga price list resmi kami Rp 68.500/Lsn kak, sama untuk semua reseller.', 'reseller').ok).toBe(true);
  });

  it('passes a plain figure for a known buyer type', () => {
    expect(verifyReplyTier('Handle Newton Rp 294.000/Set kak, minimal 3 set.', 'end_user').ok).toBe(true);
    expect(verifyReplyTier('Newton Rp 210.000/Set kak.', 'project').ok).toBe(true);
  });
});

// UAT Run 2 F-27: nothing was sent, yet the bot said it had, twice, and then sent the customer looking
// through his own folders.
describe('verifyReplyCatalogClaim — no "sudah dikirim" unless a file went out this turn', () => {
  it.each([
    'Baik Kak Hendra, daftar harga semua merek sudah saya kirimkan ya 😊 Setelah lihat-lihat, ada yang menarik?', // F-01
    'Baik Kak Hendra, katalognya sudah saya kirim ulang ya 😊 Semoga kali ini bisa masuk dengan lancar.', // F-02
    'Price list Kertas Supreme sudah terkirim ya kak.',
    'Wah, mungkin belum masuk ya Kak. Coba cek lagi di chat atau folder file.', // F-02, 11.02
  ])('rejects: %s', (m) => {
    const out = verifyReplyCatalogClaim(m, false);
    expect(out.ok).toBe(false);
    // The next step is the order details, never a buyer type.
    expect(out.reason).toContain('barang apa yang mau dikemas');
    expect(out.reason).toContain('hitung_harga');
    expect(out.reason).not.toMatch(/tipe pembeli|dipakai sendiri/);
  });

  // Review fix m6: the price list is "daftar harga" in Indonesian.
  it('rejects "daftar harganya sudah saya kirim" when nothing went out', () => {
    expect(verifyReplyCatalogClaim('Daftar harganya sudah saya kirim ya kak 🙏', false).ok).toBe(false);
    expect(verifyReplyCatalogClaim('Daftar harga Kertas Supreme sudah terkirim kak.', false).ok).toBe(false);
    expect(verifyReplyCatalogClaim('Daftar harganya sudah saya kirim ya kak 🙏', true).ok).toBe(true);
  });

  it('allows the claim when the note says the file really went out', () => {
    expect(verifyReplyCatalogClaim('Daftar harga Imperial Indopack sudah saya kirim ya kak 😊', true).ok).toBe(true);
  });

  it('allows a sentence that refers back to an earlier real send', () => {
    expect(verifyReplyCatalogClaim('Daftar harga yang tadi sudah saya kirim itu sudah termasuk ongkir ya kak.', false).ok).toBe(true);
  });

  it('ignores sends that are not about a catalog', () => {
    expect(verifyReplyCatalogClaim('Pesanannya sudah saya teruskan, nanti dikirim tim ya kak.', false).ok).toBe(true);
  });
});

// UAT Run 2 C-06: "Tidak ada kewajiban kontrak atau syarat administratif yang rumit" to a reseller.
describe('verifyReplyMeta - internal terms', () => {
  it('rejects "kontrak" and "SOP"', () => {
    const out = verifyReplyMeta('*Tidak ada kewajiban kontrak atau syarat administratif yang rumit* 😊');
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('"kontrak"');
    expect(verifyReplyMeta('Sesuai SOP kami, minimal 1 lusin ya kak.').ok).toBe(false);
  });

  it('leaves "sop" in lowercase and words that merely contain the letters alone', () => {
    expect(verifyReplyMeta('Wah, habis makan sop ya kak? Minimal ambilnya 1 lusin ya.').ok).toBe(true);
    expect(verifyReplyMeta('Kontraktor juga banyak yang ambil di kami kak.').ok).toBe(true);
  });

  // Live 2026-10-14: a repaired reply opened with the repair instruction read back to the customer.
  // Review fix (Task 10 m6): the price tool is internal machinery too.
  it('rejects the price tool and the calculator named to the customer', () => {
    const out = verifyReplyMeta('Saya cek dulu di hitung_harga ya kak.');
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('"hitung_harga"');
    expect(verifyReplyMeta('Sebentar kak, saya hitung pakai kalkulator dulu.').ok).toBe(false);
    expect(verifyReplyMeta('Untuk 10 rim harganya Rp 1.900/pcs kak, sudah saya hitungkan.').ok).toBe(true);
  });

  it('rejects the repair instruction read back, not an ordinary "tulis ulang"', () => {
    expect(verifyReplyMeta('Saya perlu menulis ulang balasan saya dengan informasi yang benar, Kak Budi 🙏').ok).toBe(false);
    expect(verifyReplyMeta('Boleh tulis ulang alamat lengkapnya kak?').ok).toBe(true);
  });
});

// UAT A-05, Run 1 and Run 2 (and the replay after the Tone example was removed): the reply to the
// customer's name was an open "ada yang bisa saya bantu carikan?" instead of the buyer-type question.
// Client 2026-11-02: a greeting with no need stated gets "Ada yang bisa saya bantu?" - and only that.
// Replayed, 1 run in 3 tacked the name question on as well.
describe('verifyReplyFirstGreeting - the open question alone, no name question with it', () => {
  it('repairs (soft) the open question asked together with the name', () => {
    const out = verifyReplyFirstGreeting('Haloo siang kak! 😊 Iya betul, saya Rina dari Legacy. Ada yang bisa saya bantu kak? Sebelumnya, dengan siapa saya terhubung ya?');
    expect(out.ok).toBe(false);
    expect(out.soft).toBe(true);
  });
  it.each([
    'Haloo siang kak! 😊 Iya betul, saya Rina dari Legacy. Ada yang bisa saya bantu kak?',
    'Halo kak! Ada kok, kami punya handle pintu Vintage 😊 Sebelumnya, dengan siapa saya terhubung ya?',
  ])('passes: %s', (m) => expect(verifyReplyFirstGreeting(m).ok).toBe(true));
});

describe('verifyReplyOpener - on an opening turn the next question is the name, then what they pack', () => {
  it('rejects the open question that replaces them, and repairs towards the order details', () => {
    const out = verifyReplyOpener('Salam kenal, Kak Hendra! 😊 Ada yang bisa saya bantu carikan hari ini?');
    expect(out.ok).toBe(false);
    expect(out).not.toHaveProperty('askBuyerType');
    expect(out.reason).toContain('barang apa yang mau dikemas');
    expect(out.reason).not.toMatch(/tipe pembeli|dipakai sendiri|dijual lagi/);
    expect(verifyReplyOpener('Halo! Selamat datang di Kertas Supreme 😊 Ada yang bisa saya bantu carikan hari ini?').ok).toBe(false);
  });

  it('allows it next to the name question or the question of what they pack (Run 2 A-01 passed like this)', () => {
    expect(verifyReplyOpener('Halo! 😊 Ada yang bisa saya bantu carikan hari ini? Sebelumnya, dengan siapa saya terhubung ya?').ok).toBe(true);
    expect(verifyReplyOpener('Salam kenal, Kak Hendra 😊 Ada yang bisa saya bantu? Kemasannya untuk makanan apa kak?').ok).toBe(true);
    expect(verifyReplyOpener('Ada yang bisa saya bantu kak? Mau dikemas untuk apa?').ok).toBe(true);
  });

  it('leaves other questions alone', () => {
    expect(verifyReplyOpener('Wah, itu nggak bisa aku bagikan ya kak 🙏 Ada kemasan yang lagi dicari?').ok).toBe(true);
    expect(verifyReplyOpener('Salam kenal, Kak Hendra 😊 Kertasnya untuk membungkus apa kak?').ok).toBe(true);
  });
});

// Live 2026-10-08 (Kak Rei): asked a third time for a long-neck Gembok Bulat Putih, the customer got
// "Baik Kak Rei, aku tekankan lagi dari katalog kami: ...". The client asked for an apology and a
// hand-off instead.
// Client, 2026-10-13: an item we do not carry gets a plain no - not "sepertinya", and no questions
// about what it is for (live: palu 5kg -> buyer type -> "untuk proyek atau pekerjaan sendiri?").
// Pak Abi, 2026-10-12: "mirip ALEXANDER HITAM (belum pasti)" became "Iya kak, ini memang produk kami".
describe('verifyReplyPhotoClaim', () => {
  const SIMILAR = 'PERBANDINGAN FOTO: foto pelanggan MIRIP foto produk kami HANDLE BESAR HITAM ALEXANDER, tapi belum pasti model yang sama.';
  const NONE = 'PERBANDINGAN FOTO: foto pelanggan sudah dibandingkan dengan foto produk A, B dan TIDAK ada yang sama.';
  it('asks for a repair when "mirip" is told as "it is ours"', () => {
    expect(verifyReplyPhotoClaim('Iya kak, ini memang produk kami - Handle Besar Hitam Alexander', SIMILAR)).toMatchObject({ ok: false, soft: true });
    expect(verifyReplyPhotoClaim('Ini sama persis dengan Alexander kak', NONE)).toMatchObject({ ok: false, soft: true });
    expect(verifyReplyPhotoClaim('Ini cocok dengan produk kami - Handle Pisah Austenic', NONE)).toMatchObject({ ok: false, soft: true });
  });
  it('passes a question, and any reply on a turn without a photo verdict', () => {
    expect(verifyReplyPhotoClaim('Apakah yang dimaksud Handle Besar Hitam Alexander ini kak?', SIMILAR).ok).toBe(true);
    expect(verifyReplyPhotoClaim('Saya cek dulu apakah kami punya handle yang sama persis seperti di foto', NONE).ok).toBe(true);
    expect(verifyReplyPhotoClaim('Iya kak, ini memang produk kami', 'no photo here').ok).toBe(true);
    expect(verifyReplyPhotoClaim('Iya kak, ini memang produk kami', 'PERBANDINGAN FOTO: foto pelanggan SAMA dengan foto produk kami X.').ok).toBe(true);
  });
});

describe('verifyReplyNotCarried', () => {
  it.each([
    'Untuk palu 5kg, sepertinya belum ada di kami ya.',
    'Palu 5kg belum ada di kami. Kalau boleh tahu, palu 5kg ini untuk keperluan apa ya?',
    'Mesin gerinda tidak ada di kami kak, mungkin ada alternatif lain yang bisa saya carikan?',
  ])('asks for a repair: %s', (m) => expect(verifyReplyNotCarried(m)).toMatchObject({ ok: false, soft: true }));
  it.each([
    'Mohon maaf kak, palu 5 kg belum ada di kami ya 🙏 Kalau ada barang lain yang sedang dicari, dengan senang hati saya bantu.',
    // out of stock is not "not carried": the question about the door is part of choosing a variant
    'Yang 30mm-nya belum ada kak, yang ready 25mm. Untuk pintu apa ya kak?',
    'Yang 30mm stoknya belum ada kak, yang ready 25mm. Untuk apa ya kak?',
    // the allowed hedge about FIT
    'Sepertinya belum ada yang cocok untuk pintu kaca kak, saya pastikan dulu ya.',
    'Ada kak, handle tanggung untuk pintu kamar. Untuk apa ya kak?',
  ])('passes: %s', (m) => expect(verifyReplyNotCarried(m).ok).toBe(true));
});

describe('verifyReplyTone', () => {
  it('flags the live sentence, as a soft rewrite - never a hand-off on its own', () => {
    const r = verifyReplyTone('Baik Kak Rei, aku tekankan lagi dari katalog kami: GEMBOK BULAT PUTIH hanya tersedia dalam satu varian standar');
    expect(r.ok).toBe(false);
    expect(r.soft).toBe(true);
    expect(r.reason).toMatch(/confidence "low"/);
  });

  it.each([
    'Saya tegaskan, varian itu tidak ada ya kak.',
    'Perlu saya tekankan bahwa ukurannya hanya 40, 50, dan 60mm.',
    'Seperti yang sudah saya sampaikan, gembok ini tidak punya leher panjang.',
    'Seperti tadi aku jelaskan, warnanya cuma putih.',
  ])('flags lecturing phrasing: %s', (m) => expect(verifyReplyTone(m).ok).toBe(false));

  it.each([
    'Mohon maaf kak, untuk gembok putih di kami adanya Gembok Bulat Putih ukuran 40, 50, dan 60mm ya kak.',
    'Seperti yang kakak sebutkan, untuk pagar rumah ya kak.',
    'Coba saya tanyakan dulu ke tim ya kak.',
    'Terima kasih sekali lagi, saya catat pesanannya ya kak.',
  ])('lets ordinary replies through: %s', (m) => expect(verifyReplyTone(m).ok).toBe(true));
});

it('tells the model to hand off, not re-explain, when a customer insists on a variant we lack', () => {
  expect(SYSTEM_PROMPT_BEHAVIORAL_RULES).toMatch(/TETAP meminta varian yang sama[^\n]*confidence "low"/);
  expect(SYSTEM_PROMPT_BEHAVIORAL_RULES).toMatch(/Mohon maaf kak, untuk <yang diminta> di kami adanya/);
  // No catalog fact in the examples: "gembok putih" can also be the gembok kotak (client, 2026-10-09),
  // and an example naming one product taught the model that mapping.
  expect(SYSTEM_PROMPT_BEHAVIORAL_RULES).not.toMatch(/GEMBOK BULAT PUTIH|Gembok Bulat Putih/);
  expect(SYSTEM_PROMPT_BEHAVIORAL_RULES).toMatch(/LEBIH DARI SATU produk/);
});

// Team, 2026-11-08: the name asked again after "Dengan Jovi ka".
describe('the name the customer already gave', () => {
  const asked = { role: 'assistant', content: 'Halo Kak 😊 Sebelumnya, dengan siapa saya terhubung ya?' };

  it.each([
    ['Dengan Jovi ka', 'Jovi'],
    ['Baik\nSaya Bang Al dari probolinggo', 'Al'],
    ['nama saya Budi kak', 'Budi'],
    ['oh iya, sama Hendra', 'Hendra'],
  ])('reads %j as a name', (answer, name) => {
    expect(nameGivenIn([asked, { role: 'user', content: answer }])).toBe(name);
  });

  it.each(['Baik kk', 'saya mau tanya handle', 'Saya Mau order', 'dengan harga berapa?', 'Untuk lokasi malang ka'])(
    'does not read %j as a name', (answer) => {
      expect(nameGivenIn([asked, { role: 'user', content: answer }])).toBeNull();
    });

  it('only counts an answer to the name question', () => {
    expect(nameGivenIn([{ role: 'user', content: 'Dengan Jovi ka' }, asked])).toBeNull();
  });

  it('recognises "Boleh tahu nama kakak siapa?" as a name question', () => {
    expect(ASKS_NAME_RE.test('Baik kak, di Malang ya 😊 Boleh tahu nama kakak siapa?')).toBe(true);
    expect(ASKS_NAME_RE.test('Boleh saya tahu nama kakak siapa?')).toBe(true);
  });

  // Review fix (Task 10 m1): the hand-off's own wording is a name question; a business-name question is not.
  it('reads the hand-off\'s "dengan kakak siapa" as a name question, and the business name as not one', () => {
    expect(ASKS_NAME_RE.test('Sambil menunggu, dengan kakak siapa saya bicara?')).toBe(true);
    expect(ASKS_NAME_RE.test('Dengan bapak siapa saya bicara?')).toBe(true);
    for (const q of ['Sambil menunggu, boleh tahu nama usahanya kak?', 'Boleh tahu nama usaha kakak?', 'Boleh tau nama tokonya kak?', 'Siapa nama usahanya kak?']) {
      expect(ASKS_NAME_RE.test(q), q).toBe(false);
    }
  });

  it('repairs a reply that asks it again', () => {
    expect(verifyReplyNameRepeat('Baik kak, di Malang ya 😊 Boleh tahu nama kakak siapa?', 'Jovi')).toMatchObject({ ok: false, soft: true });
    expect(verifyReplyNameRepeat('Salam kenal, Kak Jovi 😊 Kemasannya untuk jualan apa kak?', 'Jovi').ok).toBe(true);
    expect(verifyReplyNameRepeat('Boleh tahu nama kakak siapa?', null).ok).toBe(true);
  });
});

// Team, 2026-11-09: an item we do not sell was followed by the name question and "membutuhkan apa
// saja?" - "langsung ditutup aja".
describe('a not-carried reply closes the chat', () => {
  it.each([
    'Mohon maaf, gelas plastik belum ada di kami ya 🙏. Kalau ada kemasan lain yang sedang dicari, dengan senang hati saya bantu. Sebelumnya, dengan siapa saya terhubung ya?',
    'Mohon maaf kak, gelas plastik belum ada di kami ya. Kakak membutuhkan kemasan apa saja?',
  ])('repairs a question after "belum ada di kami": %s', (m) => {
    expect(verifyReplyNotCarriedCloses(m, false)).toMatchObject({ ok: false, soft: true });
  });

  it('lets the closing line through', () => {
    expect(verifyReplyNotCarriedCloses('Mohon maaf kak, gelas plastik belum ada di kami ya 🙏 Kalau ke depannya ada kebutuhan kemasan kertas atau box, jangan sungkan hubungi kami kembali ya kak.', false).ok).toBe(true);
  });

  it('leaves a reply that offers one of our products alone', () => {
    expect(verifyReplyNotCarriedCloses('Gelas plastik belum ada di kami ya kak, untuk takeaway di kami ada paper bag. Sebelumnya, dengan siapa saya terhubung ya?', true).ok).toBe(true);
  });

  it('is in the prompt', () => {
    expect(SYSTEM_PROMPT_BEHAVIORAL_RULES).toMatch(/TIDAK ada pertanyaan sama sekali/);
    expect(SYSTEM_PROMPT_BEHAVIORAL_RULES).not.toMatch(/Di balasan pertama, tambahkan pertanyaan nama/);
  });
});
