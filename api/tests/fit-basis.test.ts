/**
 * fit-basis.test.ts
 * A recommendation the catalog contradicts must never reach the customer.
 *
 * Four generations of string heuristics (prompt precedence, verbatim citations, substrate
 * vocabularies) each caught one replay's phrasing and missed the next: the model once cited
 * DOORPULL's "khususnya pada pintu kayu" VERBATIM while claiming a glass-door fit. The check is
 * now an independent judge (generator→verifier→one repair). These tests script the judge's
 * verdict and assert the pipeline around it; the judge's own quality is exercised by live
 * replays, not unit tests.
 *
 * Reads nothing but its own fixtures - no DATABASE_URL, no API key.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  verifyFit,
  extractCatalogBlock,
  productBlocks,
  parseJudgeVerdict,
  buildJudgeSituation,
  productsOfNamedType,
  RESPOND_FIELD_DESC,
  JUDGE_SYSTEM_PROMPT,
  type FitVerdict,
} from '../src/services/aiLayer.js';
import type { AIResponse } from '../src/domain/types.js';
import { CATALOG_SENT_MARKER } from '../src/domain/constants.js';
import { formatProducts } from '../src/services/ragQuery.js';
import { IVORY_BOX } from './price-fixtures.js';

const FUNGSI_DOORPULL =
  'Sebagai pegangan untuk membuka dan menutup pintu dengan cara ditarik atau didorong, khususnya pada pintu kayu.';

const SYSTEM_PROMPT = `## Identity
Kamu adalah Rina.

--- KATALOG PRODUK ---
KATALOG PRODUK RELEVAN:

Merek: Vintage
Kategori (petunjuk pencarian): Door Pull
Produk: DOORPULL PERTH VINTAGE BLUE
[DATA KATALOG RESMI - otoritatif untuk kecocokan]
Fungsi: ${FUNGSI_DOORPULL}
Bahan: Zinc Alloy
Varian:
  - BLACK CHROME - 36CM: Rp 105.000/Set
  - SILVER CHROME - 36CM: Rp 105.000/Set

Merek: Vintage
Kategori (petunjuk pencarian): Engsel
Produk: ENGSEL STAINLESS STEEL SILVER VINTAGE
[DATA KATALOG RESMI - otoritatif untuk kecocokan]
Fungsi: Sebagai engsel pintu.
Varian:
  - 4": Rp 42.000/Set

--- AKHIR KATALOG ---`;

// Mirrors the real block's shape: "handle"/"besar"/"tanggung" span many names, so none of them
// identifies a family on its own. (Rarity is judged against the block actually shown.)
const MULTI_PRODUCT_PROMPT = `--- KATALOG PRODUK ---
${['EINSTEIN', 'NEWTON', 'TESLA', 'GRAHAM', 'KEVIN']
    .map((t) => `Produk: HANDLE BESAR + BODY KUNCI VINTAGE TIPE ${t}\nFungsi: Sebagai pegangan pintu utama.`)
    .join('\n')}
${['MADRID', 'SEVILLA', 'PALMA', 'MALAGA', 'SANTIAGO']
    .map((t) => `Produk: HANDLE TANGGUNG + BODY KUNCI VINTAGE TIPE ${t}\nFungsi: Sebagai pegangan pintu kamar.`)
    .join('\n')}
--- AKHIR KATALOG ---`;

const GLASS_SITUATION = 'handle tarik pintu kaca frameless stainless';

// A customer who has said what the purchase is for - with the type unknown, verifyReplyTier
// would refuse the Rp figure before the judge is ever reached.
const reply = (over: Partial<AIResponse> = {}): AIResponse => ({
  message: 'Ada kok! DOORPULL PERTH VINTAGE BLUE pas untuk pintu seperti itu, Rp 105.000/Set.',
  confidence: 'high',
  customerType: 'end_user',
  ...over,
});

// A judge scripted with a fixed verdict; records what it was shown.
function scriptedJudge(...verdicts: FitVerdict[]) {
  const calls: { situation: string; officialData: string; proposedReply: string }[] = [];
  let i = 0;
  const judge = async (situation: string, officialData: string, proposedReply: string): Promise<FitVerdict> => {
    calls.push({ situation, officialData, proposedReply });
    return verdicts[Math.min(i++, verdicts.length - 1)];
  };
  return { judge, calls };
}

const OK: FitVerdict = { ok: true, reason: '' };
const CONTRADICTS: FitVerdict = { ok: false, reason: 'Fungsi produk khusus pintu kayu, pelanggan butuh pintu kaca.' };

const noRegenerate = vi.fn(async () => {
  throw new Error('regenerate must not be called');
});

describe('catalog block plumbing', () => {
  it('finds the catalog block inside the assembled system prompt', () => {
    const block = extractCatalogBlock(SYSTEM_PROMPT);
    expect(block).toContain('DOORPULL PERTH VINTAGE BLUE');
    expect(block).not.toContain('Kamu adalah Rina');
  });

  it('slices only the named products for the judge', () => {
    const block = extractCatalogBlock(SYSTEM_PROMPT);
    const data = productBlocks(block, ['DOORPULL PERTH VINTAGE BLUE']);
    expect(data).toContain('khususnya pada pintu kayu');
    expect(data).toContain('36CM');
    expect(data).not.toContain('ENGSEL');
  });
});

describe('verifyFit — a fit claim about a product TYPE (UAT Run 3 D-10)', () => {
  // 14:10:42, verbatim. No product is named, so the judge used to be skipped and never saw
  // DOORPULL's own "khususnya pada pintu kayu".
  const D10 = 'Salam kenal, Kak Budi 😊 Untuk pintu kaca lobby kantor, kami punya handle tarik (doorpull) yang cocok banget. Doorpull kami panjang dan nyaman digenggam, cocok untuk pintu kaca frameless.';

  it('hands the judge the products of the type the reply names', async () => {
    const { judge, calls } = scriptedJudge(CONTRADICTS);
    const honest = reply({ message: 'Untuk pintu kaca belum ada yang pas di kami kak, coba saya tanyakan ke tim ya.' });
    const regenerate = vi.fn(async () => honest);
    const out = await verifyFit(reply({ message: D10 }), SYSTEM_PROMPT, 'ada handle untuk pintu kaca lobby kantor?', { judge, regenerate });
    expect(calls[0].officialData).toContain('khususnya pada pintu kayu');
    expect(calls[0].officialData).not.toContain('ENGSEL');
    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(out.message).toBe(honest.message);
  });

  it('leaves a type mention with no fit claim alone', async () => {
    const message = 'Doorpull kami ada beberapa model kak. Sebelumnya, dengan siapa saya terhubung ya?';
    const out = await verifyFit(reply({ message }), SYSTEM_PROMPT, '', { judge: noRegenerate as never, regenerate: noRegenerate });
    expect(out.message).toBe(message);
  });

  it('reads a category written as one word or two, and gives up on a type too wide to judge', () => {
    const block = extractCatalogBlock(SYSTEM_PROMPT);
    expect(productsOfNamedType(block, 'doorpull kami cocok')).toEqual(['DOORPULL PERTH VINTAGE BLUE']);
    expect(productsOfNamedType(block, 'door pull ini pas untuk kantor')).toEqual(['DOORPULL PERTH VINTAGE BLUE']);
    const wide = Array.from({ length: 13 }, (_, i) => `Merek: Blossom\nKategori (petunjuk pencarian): Gembok\nProduk: GEMBOK ${i}\n`).join('\n');
    expect(productsOfNamedType(wide, 'gembok kami cocok untuk pesisir')).toEqual([]);
  });
});

describe('verifyFit — soft objections repair but never hand off (R-11)', () => {
  // A lecturing tone (verifyReplyTone) is the soft rule here; the drafts quote a real tier of the
  // Imperial catalog with no tool call, so the strict price check passes them.
  const IMPERIAL_PROMPT = `--- KATALOG PRODUK ---\n${formatProducts([IVORY_BOX])}--- AKHIR KATALOG ---`;
  const SITUATION = 'harga box ivory berapa';
  const imperial = (message: string, over: Partial<AIResponse> = {}): AIResponse => ({ message, confidence: 'high', ...over });
  const bare = imperial('Seperti yang sudah aku sampaikan, Box Ivory 270 gsm cetak full color mulai 5 rim Rp 2.000/pcs kak.');
  const full = imperial('Box Ivory 270 gsm cetak full color mulai 5 rim Rp 2.000/pcs kak, 10 rim Rp 1.800/pcs.');

  it('repairs a draft that breaks only a soft rule', async () => {
    const regenerate = vi.fn(async () => full);
    const out = await verifyFit(bare, IMPERIAL_PROMPT, SITUATION, { judge: scriptedJudge(OK).judge, regenerate });
    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(regenerate.mock.calls[0][0]).toContain('menggurui');
    expect(out.message).toBe(full.message);
  });

  it('sends the draft once the repairs run out - a soft objection is not a hand-off', async () => {
    const out = await verifyFit(bare, IMPERIAL_PROMPT, SITUATION, { judge: scriptedJudge(OK).judge, regenerate: vi.fn(async () => bare) });
    expect(out).toMatchObject({ confidence: 'high', message: bare.message });
  });

  it('keeps the sendable draft when the repair gives up and answers low', async () => {
    const gaveUp = imperial('', { confidence: 'low' });
    const out = await verifyFit(bare, IMPERIAL_PROMPT, SITUATION, { judge: scriptedJudge(OK).judge, regenerate: vi.fn(async () => gaveUp) });
    expect(out).toMatchObject({ confidence: 'high', message: bare.message });
  });

  it('keeps the sendable draft when a repair breaks a hard rule', async () => {
    const invented = imperial('Box Ivory 270 gsm cetak full color mulai 5 rim Rp 1.900/pcs kak.');
    const out = await verifyFit(bare, IMPERIAL_PROMPT, SITUATION, { judge: scriptedJudge(OK).judge, regenerate: vi.fn(async () => invented) });
    expect(out).toMatchObject({ confidence: 'high', message: bare.message });
  });
});

describe('confidence field (UAT Run 3 R-02)', () => {
  it('keeps an out-of-stock product and "are you a bot?" on high', () => {
    expect(RESPOND_FIELD_DESC.confidence).toContain('out of stock is still relevant');
    expect(RESPOND_FIELD_DESC.confidence).toContain('not a request for a human');
  });
});

describe('verifyFit — the judge pipeline', () => {
  it('passes an approved reply through untouched', async () => {
    const { judge, calls } = scriptedJudge(OK);
    const out = await verifyFit(reply(), SYSTEM_PROMPT, GLASS_SITUATION, { judge, regenerate: noRegenerate });
    expect(out.confidence).toBe('high');
    expect(out.message).toContain('DOORPULL');
    // The judge saw the real official data and the situation, not the model's self-report.
    expect(calls[0].officialData).toContain('khususnya pada pintu kayu');
    expect(calls[0].situation.startsWith(GLASS_SITUATION)).toBe(true);
  });

  it('repairs once when the judge objects, and sends the approved repair', async () => {
    const { judge } = scriptedJudge(CONTRADICTS, OK);
    const honest = reply({ message: 'Untuk pintu kaca belum ada di kami ya kak 🙏' });
    const regenerate = vi.fn(async (correction: string) => {
      expect(correction).toContain(CONTRADICTS.reason); // the objection reaches the rewrite
      // Live 2026-10-14 the rewrite apologised for a price the customer never saw, and promised a
      // team check nobody was told about.
      expect(correction).toMatch(/Pelanggan BELUM melihat draf/);
      expect(correction).toMatch(/jangan minta maaf atas draf/);
      expect(correction).not.toMatch(/tawarkan untuk menanyakan ke tim/);
      return honest;
    });
    const out = await verifyFit(reply(), SYSTEM_PROMPT, GLASS_SITUATION, { judge, regenerate });
    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(out.message).toBe(honest.message);
    expect(out.confidence).toBe('high');
  });

  it('escalates with an EMPTY message when both repairs are rejected too', async () => {
    const { judge } = scriptedJudge(CONTRADICTS, CONTRADICTS);
    const regenerate = vi.fn(async () => reply({ message: 'Masih klaim DOORPULL PERTH VINTAGE BLUE cocok.' }));
    const out = await verifyFit(reply(), SYSTEM_PROMPT, GLASS_SITUATION, { judge, regenerate });
    expect(regenerate).toHaveBeenCalledTimes(2);
    expect(out.confidence).toBe('low');
    // Empty message ⇒ escalateConversation sends only CANNED_ESCALATION_REPLY — the contested
    // text can never reach the customer.
    expect(out.message).toBe('');
    expect(out.escalationReason).toBe(CONTRADICTS.reason);
  });

  // UAT F-06: the escalation threw the whole turn away, so "sendiri" was never saved as the buyer
  // type and the hand-off asked "dipakai sendiri, untuk proyek, atau dijual lagi?" once more.
  it('keeps the turn\'s profile facts when it escalates - only the text is contested', async () => {
    const { judge } = scriptedJudge(CONTRADICTS, CONTRADICTS);
    const facts = { customerType: 'end_user' as const, profileUpdate: { quantity: 3 }, followUpNotes: 'Mau 3 set' };
    const regenerate = vi.fn(async () => reply({ message: 'Masih klaim DOORPULL PERTH VINTAGE BLUE cocok.', ...facts }));
    const out = await verifyFit(reply(facts), SYSTEM_PROMPT, GLASS_SITUATION, { judge, regenerate });
    expect(out.message).toBe('');
    expect(out.customerType).toBe('end_user');
    expect(out.profileUpdate).toEqual({ quantity: 3 });
    expect(out.followUpNotes).toBe('Mau 3 set');
  });

  // UAT 2026-09-25: every double failure was the rewrite breaking a DIFFERENT rule (A-03 "3 inch
  // ready" -> "3 inch kosong"; B-02 "pricelist" -> "Black Silver (BNSN)"). The third draft gets both.
  it('gives the second repair every objection so far, and sends the draft that passes', async () => {
    const first: FitVerdict = { ok: false, reason: 'Varian 3" Aomori stoknya habis.' };
    const second: FitVerdict = { ok: false, reason: 'ENGSEL STAINLESS STEEL VINTAGE 3" tersedia.' };
    const { judge } = scriptedJudge(first, second, OK);
    const fixed = reply({ message: 'DOORPULL PERTH VINTAGE BLUE yang 36CM ada kak, Rp 105.000/Set.' });
    const regenerate = vi.fn()
      .mockResolvedValueOnce(reply({ message: 'DOORPULL PERTH VINTAGE BLUE kosong kak.' }))
      .mockResolvedValueOnce(fixed);
    const out = await verifyFit(reply(), SYSTEM_PROMPT, GLASS_SITUATION, { judge, regenerate });
    expect(regenerate).toHaveBeenCalledTimes(2);
    const secondCorrection = regenerate.mock.calls[1][0] as string;
    expect(secondCorrection).toContain(first.reason);
    expect(secondCorrection).toContain(second.reason);
    expect(out).toBe(fixed);
  });

  // The catalog note in the prompt is the record of whether a file went out this turn (F-27).
  it('repairs a claimed catalog send unless the prompt carries the sent-note', async () => {
    const claim = reply({ message: 'Katalog Vintage sudah saya kirimkan ya kak 😊' });
    const honest = reply({ message: 'Boleh kak, untuk merek apa?' });
    const regenerate = vi.fn(async () => honest);
    const out = await verifyFit(claim, SYSTEM_PROMPT, '', { judge: noRegenerate as never, regenerate });
    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(out.message).toBe(honest.message);

    const sentPrompt = `${SYSTEM_PROMPT}\n--- INFORMASI PELANGGAN ---\n${CATALOG_SENT_MARKER} Vintage sudah dikirim.\n--- AKHIR INFORMASI PELANGGAN ---`;
    expect(await verifyFit(claim, sentPrompt, '', { judge: noRegenerate as never, regenerate: noRegenerate })).toBe(claim);
  });

  // UAT A-05: "saya Hendra" -> "Ada yang bisa saya bantu carikan hari ini?" instead of the buyer type.
  it('on an opening turn, repairs an open question that skips the buyer type - and only there', async () => {
    const open = reply({ customerType: null, message: 'Salam kenal, Kak Hendra! 😊 Ada yang bisa saya bantu carikan hari ini?' });
    const asks = reply({ customerType: null, message: 'Salam kenal, Kak Hendra 😊 Boleh tahu, rencananya untuk dipakai sendiri, untuk proyek, atau dijual lagi?' });
    const regenerate = vi.fn(async () => asks);
    const out = await verifyFit(open, SYSTEM_PROMPT, 'saya Hendra', { judge: noRegenerate as never, regenerate, openingTurn: true });
    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(out).toBe(asks);

    expect(await verifyFit(open, SYSTEM_PROMPT, 'bodoh banget sih', { judge: noRegenerate as never, regenerate: noRegenerate })).toBe(open);
  });

  // Replayed 2026-10-13: "budi" after "mesin gerinda belum ada di kami" -> the opener repair turned
  // "ada yang bisa saya bantu?" into "dipakai sendiri, proyek, atau dijual lagi?" - for an item we do not sell.
  it('lets an open offer of help through after the bot said we do not have the item', async () => {
    const open = reply({ customerType: null, message: 'Salam kenal, Kak Budi 😊 Ada yang bisa saya bantu carikan selain itu?' });
    const out = await verifyFit(open, SYSTEM_PROMPT, 'budi', { judge: noRegenerate as never, regenerate: noRegenerate, openingTurn: true, afterNotCarried: true });
    expect(out).toBe(open);
  });

  it('accepts a repair that stops naming products without calling the judge again', async () => {
    const { judge, calls } = scriptedJudge(CONTRADICTS);
    const regenerate = vi.fn(async () => reply({ message: 'Untuk model seperti itu belum ada di kami kak.' }));
    const out = await verifyFit(reply(), SYSTEM_PROMPT, GLASS_SITUATION, { judge, regenerate });
    expect(out.confidence).toBe('high');
    expect(calls).toHaveLength(1); // repair names no product — nothing left to judge
  });

  it('never judges a reply that names no catalog product', async () => {
    const { judge, calls } = scriptedJudge(OK);
    const greeting = reply({ message: 'Halo kak! Sebelumnya, dengan siapa saya terhubung ya?' });
    const out = await verifyFit(greeting, SYSTEM_PROMPT, '', { judge, regenerate: noRegenerate });
    expect(out).toBe(greeting);
    expect(calls).toHaveLength(0);
  });

  it('never judges generic family talk over a realistic multi-product block', async () => {
    const { judge, calls } = scriptedJudge(OK);
    const generic = reply({ message: 'Untuk pintu kayu kami ada handle besar dan handle tanggung juga kak.' });
    await verifyFit(generic, MULTI_PRODUCT_PROMPT, '', { judge, regenerate: noRegenerate });
    expect(calls).toHaveLength(0);
  });

  // Found live: the model answers "DOORPULL PERTH", not the full catalog name.
  it('judges a shortened product name', async () => {
    const { judge, calls } = scriptedJudge(OK);
    const short = reply({ message: 'Kami rekomendasikan **DOORPULL PERTH** — Rp 105.000/Set.' });
    await verifyFit(short, SYSTEM_PROMPT, GLASS_SITUATION, { judge, regenerate: noRegenerate });
    expect(calls).toHaveLength(1);
  });

  it('skips low-confidence responses — their text never reaches the customer', async () => {
    const { judge, calls } = scriptedJudge(OK);
    const low = reply({ confidence: 'low', escalationReason: 'Pelanggan minta diskon' });
    const out = await verifyFit(low, SYSTEM_PROMPT, GLASS_SITUATION, { judge, regenerate: noRegenerate });
    expect(out.escalationReason).toBe('Pelanggan minta diskon');
    expect(calls).toHaveLength(0);
  });

  it('does nothing when the prompt carries no catalog block', async () => {
    const { judge, calls } = scriptedJudge(OK);
    await verifyFit(reply(), '## Identity\nKamu adalah Rina.', '', { judge, regenerate: noRegenerate });
    expect(calls).toHaveLength(0);
  });
});

// Run 2 replays: the judge rejected correct drafts for "BNSN" (variant "BNSN SNCP SS"), '4" SN'
// (variant '4" SN (BLISTER)'), BNSN / SNCP / SS offered as three colours, and "30mm lagi habis, yang
// ready 25mm" - each a hand-off on an ordinary question once the repairs ran out.
describe('JUDGE_SYSTEM_PROMPT - what is not a contradiction', () => {
  it('accepts a shortened or split variant name, and an honest out-of-stock alternative', () => {
    expect(JUDGE_SYSTEM_PROMPT).toContain("mis. 'BNSN SNCP SS', 'BNSN, SNCP'");
    expect(JUDGE_SYSTEM_PROMPT).toContain('BUKAN varian karangan');
    expect(JUDGE_SYSTEM_PROMPT).toMatch(/\[STOK HABIS SEMENTARA\] sedang habis\/kosong SELALU benar/);
  });
});

// Live 2026-10-25 (Kak Dikman): "Ini minta totalkan harga nya" over a whole house list. Every draft added
// the items up, verifyReplyPrices rejected each sum as a price not in the catalog, and after two repairs
// the turn was handed off - the per-item answers, all correct, never reached the customer. Owner's call
// 2026-10-27: send those, and the team calculates the total.
// A total that adds up is fine (verifyReplyPrices checks the sum); these are totals that do not.
describe('verifyFit - a total the catalog cannot back', () => {
  const ITEMS = 'DOORPULL PERTH VINTAGE BLUE 36CM: Rp 105.000/Set\nENGSEL STAINLESS STEEL SILVER VINTAGE 4": Rp 42.000/Set';
  const project = (message: string): AIResponse => ({ message, confidence: 'high', customerType: 'project' });

  it('sends the per-item answer without the total, and marks the total for the team', async () => {
    const draft = project(`${ITEMS}\nTotal 1 rumah: Rp 150.000`);
    const regenerate = vi.fn(async () => draft);
    const out = await verifyFit(draft, SYSTEM_PROMPT, 'jadi total berapa', { judge: scriptedJudge(OK).judge, regenerate });
    expect(out.confidence).toBe('high');
    expect(out.totalForTeam).toBe(true);
    expect(out.message).toContain('Rp 105.000/Set');
    expect(out.message).toContain('Rp 42.000/Set');
    expect(out.message).not.toContain('150.000');
    expect(out.message).not.toMatch(/total/i);
  });

  it('still hands off when an invented figure is not a total', async () => {
    const draft = project('DOORPULL PERTH VINTAGE BLUE 36CM: Rp 99.000/Set');
    const out = await verifyFit(draft, SYSTEM_PROMPT, 'berapa harganya', { judge: scriptedJudge(OK).judge, regenerate: vi.fn(async () => draft) });
    expect(out.confidence).toBe('low');
    expect(out.totalForTeam).toBeUndefined();
  });

  it('still hands off when what is left after the total fails the judge', async () => {
    const draft = project(`${ITEMS}\nTotal 1 rumah: Rp 150.000`);
    const out = await verifyFit(draft, SYSTEM_PROMPT, 'jadi total berapa', { judge: scriptedJudge(CONTRADICTS).judge, regenerate: vi.fn(async () => draft) });
    expect(out.confidence).toBe('low');
  });
});

describe('parseJudgeVerdict', () => {
  it('parses a clean verdict', () => {
    expect(parseJudgeVerdict('{"ok": false, "reason": "bahan beda"}')).toEqual({ ok: false, reason: 'bahan beda' });
  });

  it('parses a verdict wrapped in prose', () => {
    expect(parseJudgeVerdict('Berikut penilaiannya:\n{"ok": true, "reason": ""}\nSekian.').ok).toBe(true);
  });

  // Fail OPEN: a broken judge must degrade to no-check, not mute the bot for every customer.
  it('fails open on garbage', () => {
    expect(parseJudgeVerdict('maaf, saya tidak bisa menilai').ok).toBe(true);
  });

  it('fails open when ok is missing', () => {
    expect(parseJudgeVerdict('{"reason": "hmm"}').ok).toBe(true);
  });
});

describe('buildJudgeSituation', () => {
  it('customer words alone stay untouched', () => {
    expect(buildJudgeSituation('ada handle newton?')).toBe('ada handle newton?');
    expect(buildJudgeSituation('ada handle newton?', [])).toBe('ada handle newton?');
  });

  // The NEWTON incident: a chrome aluminium handle photographed by the customer was extracted
  // as "stainless steel" plus the spec drawing's numbers, and the unlabeled soup made the judge
  // veto the correct product for "requirements" the customer never stated.
  it('labels vision keywords as a machine guess, separate from the customer words', () => {
    const s = buildJudgeSituation('yang ini ada ga kak?', ['door handle', 'stainless steel', 'silver']);
    expect(s.startsWith('yang ini ada ga kak?\n')).toBe(true);
    expect(s).toContain('perkiraan mesin');
    expect(s).toContain('BUKAN permintaan eksplisit pelanggan');
    expect(s).toContain('door handle, stainless steel, silver');
  });

  // The ENGSEL incident: "biasa kak" answered the bot's "jendela biasa atau jendela salon?" —
  // as the judge's entire situation input it says nothing, so the judge reconstructed the
  // situation from the draft reply and invented requirements.
  it('prepends the CS question a short answer is answering', () => {
    const s = buildJudgeSituation('biasa kak', undefined, 'Untuk jendela biasa atau jendela salon?');
    expect(s).toBe('[Konteks — pesan CS sebelumnya yang sedang dijawab pelanggan: "Untuk jendela biasa atau jendela salon?"]\nbiasa kak');
  });
});

// A 1.800-pcs order once went by with the bot answering "kami catat" and nothing being noted
// anywhere: no orders table, and follow_up_status only ever moves when the model fills
// follow_up_notes. Asking it to record buy intent there is the whole mechanism - it flips
// follow_up_status to 'needs_followup', which the dashboard already surfaces.
describe('follow_up_notes field description', () => {
  it('asks the model to record concrete purchase intent, not just blockers', () => {
    const d = RESPOND_FIELD_DESC.follow_up_notes;
    expect(d).toMatch(/order/i);
    expect(d).toMatch(/quantity/i);
    // It must be clear this applies even on a turn the bot otherwise handled fine, or the
    // model reads "follow-up required" as "only when I am stuck".
    expect(d).toMatch(/even when/i);
  });
});

// Live 2026-10-08: Ika wanted PTA roofing screws, staff said we do not carry them, and the lead read
// Hot. The background lead pass has the same rule in its own prompt (tests/lead-insights-parse.test.ts).
it('tells the model a lead for a product we do not sell is cold, not hot', () => {
  const d = RESPOND_FIELD_DESC.profile_update;
  expect(d).toMatch(/"hot" when this person shows real buying intent for something we can supply/);
  expect(d).toMatch(/"cold" when [^)]*not something we sell or have/);
});
