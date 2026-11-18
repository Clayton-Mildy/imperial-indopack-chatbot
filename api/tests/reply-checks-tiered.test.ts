/**
 * reply-checks-tiered.test.ts
 * The strict price check (spec 7.5): every Rp figure in a reply is a figure hitung_harga returned
 * this turn, or - when it did not run - an exact tier price printed in the catalog block, never a
 * total. No multiple, divisor or pack tolerance: a wrong tier's price and a per-rim figure made of
 * 500 x a per-pcs price must both fail.
 *
 * Pure - fixture catalog rendered by formatProducts, no DATABASE_URL, no API key.
 */

import { describe, it, expect, vi } from 'vitest';
import { verifyReplyTieredPrices, withoutInventedTotals } from '../src/services/replyChecks.js';
import { formatProducts } from '../src/services/ragQuery.js';
import { verifyFit, type FitVerdict } from '../src/services/aiLayer.js';
import { IVORY_BOX as IVORY_FIXTURE, SUPREME } from './price-fixtures.js';
import type { PriceTier } from '../src/domain/pricing.js';
import type { AIResponse } from '../src/domain/types.js';

const BLOCK = formatProducts([IVORY_FIXTURE]); // tiers 2.000 / 1.800 / 1.500 per pcs

describe('verifyReplyTieredPrices - the plan cases', () => {
  it('accepts the tool figures', () => expect(verifyReplyTieredPrices('8 rim: Rp 2.000/pcs, total Rp 8.000.000', BLOCK, [2000, 8000000, 1800]).ok).toBe(true));
  it('rejects a wrong-tier catalog price when the tool ran', () => expect(verifyReplyTieredPrices('8 rim: Rp 1.500/pcs', BLOCK, [2000, 8000000, 1800]).ok).toBe(false));
  it('accepts listing tiers with no tool call', () => expect(verifyReplyTieredPrices('mulai Rp 2.000/pcs, 10 rim Rp 1.800/pcs', BLOCK, undefined).ok).toBe(true));
  it('rejects a total with no tool call', () => {
    const v = verifyReplyTieredPrices('Total Rp 8.000.000', BLOCK, undefined);
    expect(v.ok).toBe(false); expect(v.onlyInvented).toBe(true);
  });
  it('rejects 500 × a per-pcs price posing as a per-rim price', () => expect(verifyReplyTieredPrices('Rp 1.000.000/rim', BLOCK, undefined).ok).toBe(false));
  it('accepts figures from two tool calls in one turn', () => expect(verifyReplyTieredPrices('Rp 165.000/rim … Rp 2.000/pcs', BLOCK, [165000, 1980000, 2000, 8000000]).ok).toBe(true));
  it('a reply with no price passes', () => expect(verifyReplyTieredPrices('Boleh tahu ukurannya kak?', BLOCK, []).ok).toBe(true));
});

describe('verifyReplyTieredPrices - which figures fail, and what the model is told', () => {
  it('names the failing figure and tells the model to call hitung_harga and repeat its figures', () => {
    const v = verifyReplyTieredPrices('8 rim: Rp 1.500/pcs', BLOCK, [2000, 8000000, 1800]);
    expect(v.invented).toEqual([1500]);
    expect(v.reason).toContain('Rp 1.500');
    expect(v.reason).toContain('hitung_harga');
    expect(v.reason).toMatch(/persis/);
  });

  // The repair is written without the tool results in view (verifyFit's regenerate sends the draft
  // and the correction only), so "repeat what it returned" would ask for figures it cannot see.
  it('with the tool, tells the model the results are gone: call hitung_harga again for every item, other products too', () => {
    const { reason } = verifyReplyTieredPrices('8 rim: Rp 1.500/pcs', BLOCK, [2000, 8000000, 1800]);
    expect(reason).toContain('Hasil hitung_harga sebelumnya sudah tidak terlihat');
    expect(reason).toContain('panggil hitung_harga LAGI untuk setiap barang');
    expect(reason).toContain('jumlahnya sama atau berbeda');
    expect(reason).toContain('produk lain');
    expect(reason).toContain('ulangi angka hasilnya persis');
    expect(reason).not.toContain('seperti tertulis di hasilnya');
  });

  it('a tool call that returned no figures falls back to the catalog rule', () => {
    // Not in catalog / below the minimum: the tool ran but priced nothing.
    expect(verifyReplyTieredPrices('mulai 10 rim Rp 1.800/pcs', BLOCK, []).ok).toBe(true);
    expect(verifyReplyTieredPrices('Total Rp 8.000.000', BLOCK, []).ok).toBe(false);
  });

  it('with no tool call, a catalog price on a line that adds up is a total too', () => {
    const v = verifyReplyTieredPrices('8 rim x Rp 2.000 = Rp 8.000.000', BLOCK, undefined);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('hitung_harga');
    expect(v.onlyInvented).toBe(true);
  });

  it('a made-up figure that is not on a total line is not only a total', () => {
    const v = verifyReplyTieredPrices('8 rim harganya Rp 1.900/pcs ya kak', BLOCK, undefined);
    expect(v.ok).toBe(false);
    expect(v.invented).toEqual([1900]);
    expect(v.onlyInvented).toBe(false);
  });

  it('the tool rule allows a tool figure on a total line', () =>
    expect(verifyReplyTieredPrices('8 rim = 4.000 pcs x Rp 2.000\nTotal: Rp 8.000.000', BLOCK, [2000, 8000000, 1800]).ok).toBe(true));

  it('a grand total summing two tool totals is not a tool figure, and only a total', () => {
    const v = verifyReplyTieredPrices('Kertas: Rp 1.980.000\nBox: Rp 8.000.000\nTotal keseluruhan Rp 9.980.000', BLOCK, [165000, 1980000, 2000, 8000000]);
    expect(v.ok).toBe(false);
    expect(v.invented).toEqual([9980000]);
    expect(v.onlyInvented).toBe(true);
  });

  it('figures under Rp 1.000 are checked too - a per-lembar price is a price', () => {
    const tier = (minQty: number, priceIdr: number): PriceTier => ({ minQty, qtyUnit: 'rim', priceIdr, priceUnit: 'pcs', includesDelivery: false });
    const block = formatProducts([{ ...IVORY_FIXTURE, variants: IVORY_FIXTURE.variants!.map((v) => ({ ...v, priceTiers: [tier(5, 370), tier(10, 350)] })) }]);
    expect(verifyReplyTieredPrices('mulai Rp 370/pcs', block, undefined).ok).toBe(true);
    expect(verifyReplyTieredPrices('mulai Rp 340/pcs', block, undefined).ok).toBe(false);
    expect(verifyReplyTieredPrices('Rp 350/pcs', block, [370, 1480000, 350]).ok).toBe(true);
    expect(verifyReplyTieredPrices('Rp 360/pcs', block, [370, 1480000, 350]).ok).toBe(false);
  });

  it('a shorthand like "Rp 8 juta" is not the tool figure, so it is redone', () =>
    expect(verifyReplyTieredPrices('Totalnya Rp 8 juta kak', BLOCK, [2000, 8000000, 1800]).ok).toBe(false));
});

// The catalog's own wording is not a sum: "1 rim = 500 pcs" is in the block header, and "jumlah"
// is also the word for a quantity. Without the tool, only a total word or a real "=" makes a total.
describe('verifyReplyTieredPrices - what a total line is without the tool', () => {
  it('passes a tier listing with "(1 rim = 500 pcs)" on the price line', () => {
    expect(verifyReplyTieredPrices('Box Ivory mulai 5 rim (1 rim = 500 pcs): Rp 2.000/pcs kak', BLOCK, undefined).ok).toBe(true);
    expect(verifyReplyTieredPrices('10 rim Rp 1.800/pcs, 1 rim = 500 lembar', BLOCK, undefined).ok).toBe(true);
    expect(verifyReplyTieredPrices('mulai 2,5 rim = 1.250 pcs: Rp 2.000/pcs', BLOCK, undefined).ok).toBe(true);
  });

  it('passes "Jumlah minimal 5 rim: Rp 2.000/pcs"', () =>
    expect(verifyReplyTieredPrices('Jumlah minimal 5 rim: Rp 2.000/pcs', BLOCK, undefined).ok).toBe(true));

  it('rejects "Totalnya Rp 8.000.000" with no tool call, as only a total', () => {
    const v = verifyReplyTieredPrices('Totalnya Rp 8.000.000', BLOCK, undefined);
    expect(v.ok).toBe(false); expect(v.onlyInvented).toBe(true);
  });

  it('rejects "Semuanya jadi Rp 8.000.000" with no tool call, as only a total', () => {
    const v = verifyReplyTieredPrices('Semuanya jadi Rp 8.000.000', BLOCK, undefined);
    expect(v.ok).toBe(false); expect(v.onlyInvented).toBe(true);
  });

  it('a conversion on the line does not hide a sum on it', () => {
    const v = verifyReplyTieredPrices('8 rim (1 rim = 500 pcs) x Rp 2.000 = Rp 8.000.000', BLOCK, undefined);
    expect(v.ok).toBe(false); expect(v.onlyInvented).toBe(true);
  });

  it('a catalog price next to a total word is still a total', () =>
    expect(verifyReplyTieredPrices('Total Rp 2.000/pcs ya kak', BLOCK, undefined).ok).toBe(false));
});

describe('verifyReplyTieredPrices keeps withoutInventedTotals working', () => {
  it('a "Totalnya" or "Semuanya" line is cut like a "Total" line', () => {
    for (const total of ['Totalnya Rp 8.000.000', 'Semuanya jadi Rp 8.000.000']) {
      const msg = `Box Ivory 8 rim Rp 2.000/pcs kak.\n${total}`;
      const v = verifyReplyTieredPrices(msg, BLOCK, undefined);
      expect(v.onlyInvented).toBe(true);
      expect(withoutInventedTotals(msg, v.invented!)).toBe('Box Ivory 8 rim Rp 2.000/pcs kak.');
    }
  });

  it('with the tool, a "Totalnya" summing two tool totals is only a total, and is cut', () => {
    const msg = 'Kertas: Rp 1.980.000\nBox: Rp 8.000.000\nTotalnya Rp 9.980.000';
    const v = verifyReplyTieredPrices(msg, BLOCK, [165000, 1980000, 2000, 8000000]);
    expect(v.invented).toEqual([9980000]);
    expect(v.onlyInvented).toBe(true);
    expect(withoutInventedTotals(msg, v.invented!)).toBe('Kertas: Rp 1.980.000\nBox: Rp 8.000.000');
  });

  it('a "Semua ..." line with no figure does not open a totals section', () =>
    expect(withoutInventedTotals('Semua ukuran ready kak:\nmulai 5 rim Rp 2.000/pcs\nTotal Rp 8.000.000', [8000000]))
      .toBe('Semua ukuran ready kak:\nmulai 5 rim Rp 2.000/pcs'));

  it('a reply that quotes the tier and adds up the total itself: the total is cut, the tier kept', () => {
    // No tool call: the model did the arithmetic. Rp 2.000 is a real tier on the first line; on the
    // total line it is part of a sum. Only the sum is cut, so the per-item answer can still be sent.
    const msg = 'Untuk 8 rim harganya Rp 2.000/pcs kak.\nTotal: 8 rim x 500 x Rp 2.000 = Rp 8.000.000';
    const v = verifyReplyTieredPrices(msg, BLOCK, undefined);
    expect(v.ok).toBe(false);
    expect(v.onlyInvented).toBe(true);
    const cut = withoutInventedTotals(msg, v.invented!);
    expect(cut).toBe('Untuk 8 rim harganya Rp 2.000/pcs kak.');
    expect(verifyReplyTieredPrices(cut!, BLOCK, undefined).ok).toBe(true);
  });

  it('a total built only from a catalog figure is cut too', () => {
    const msg = 'Box Ivory 20x20x7,5 ready kak.\nTotal = Rp 2.000';
    const v = verifyReplyTieredPrices(msg, BLOCK, undefined);
    expect(v.invented).toEqual([2000]);
    expect(withoutInventedTotals(msg, v.invented!)).toBe('Box Ivory 20x20x7,5 ready kak.');
  });
});

// verifyFit runs this check in place of Legacy's tolerant one, with no buyer type anywhere: the
// price does not depend on who buys (spec 7.3), so a figure is never held back for an unknown type.
describe('verifyFit - the strict price check in the pipeline', () => {
  const PROMPT = `## Identity\nKamu adalah CS Imperial Indopack.\n\n--- KATALOG PRODUK ---\n${formatProducts([IVORY_FIXTURE, SUPREME])}--- AKHIR KATALOG ---`;
  const draft = (message: string, toolFigures?: number[]): AIResponse => ({ message, confidence: 'high', toolFigures });
  const OK: FitVerdict = { ok: true, reason: '' };
  const okJudge = () => {
    const calls: string[] = [];
    return { calls, judge: async (situation: string): Promise<FitVerdict> => { calls.push(situation); return OK; } };
  };
  const noRegenerate = vi.fn(async (): Promise<AIResponse> => { throw new Error('regenerate must not be called'); });
  const TOOL = [2000, 8_000_000, 1800]; // hitung_harga for 8 rim of the Ivory box

  it('sends a quote that repeats the tool figures, with no buyer type known', async () => {
    const quote = draft('Box Ivory 270 gsm cetak full color 20x20x7,5, 8 rim: Rp 2.000/pcs, total Rp 8.000.000. Kalau 10 rim jadi Rp 1.800/pcs kak.', TOOL);
    expect(await verifyFit(quote, PROMPT, 'box ivory 8 rim berapa', { judge: okJudge().judge, regenerate: noRegenerate })).toBe(quote);
  });

  it('sends a tier listing with no tool call, with no buyer type known', async () => {
    const tiers = draft('Box Ivory 270 gsm cetak full color 20x20x7,5: mulai 5 rim Rp 2.000/pcs, 10 rim Rp 1.800/pcs, 20 rim Rp 1.500/pcs kak.');
    expect(await verifyFit(tiers, PROMPT, 'harga box ivory?', { judge: okJudge().judge, regenerate: noRegenerate })).toBe(tiers);
  });

  it('repairs a catalog tier the tool did not return, and tells the model to repeat the tool figures', async () => {
    const wrongTier = draft('Box Ivory 270 gsm cetak full color 8 rim: Rp 1.500/pcs kak.', TOOL);
    const fixed = draft('Box Ivory 270 gsm cetak full color 8 rim: Rp 2.000/pcs, total Rp 8.000.000 kak.', TOOL);
    const regenerate = vi.fn(async () => fixed);
    const out = await verifyFit(wrongTier, PROMPT, 'box ivory 8 rim berapa', { judge: okJudge().judge, regenerate });
    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(regenerate.mock.calls[0]![0]).toContain('hitung_harga');
    expect(regenerate.mock.calls[0]![0]).toContain('Rp 1.500');
    expect(out).toBe(fixed);
  });

  it('repairs 500 x a per-pcs price quoted as a per-rim price, and hands off if it stays', async () => {
    const perRim = draft('Box Ivory 270 gsm cetak full color: Rp 1.000.000/rim kak.');
    const regenerate = vi.fn(async () => perRim);
    const out = await verifyFit(perRim, PROMPT, 'harga box ivory per rim?', { judge: okJudge().judge, regenerate });
    expect(regenerate).toHaveBeenCalledTimes(2);
    expect(out.confidence).toBe('low');
    expect(out.message).toBe('');
    expect(out.totalForTeam).toBeUndefined();
  });

  it('a total the model added up without the tool goes to the team, the tier price is sent', async () => {
    const summed = draft('Box Ivory 270 gsm cetak full color 8 rim harganya Rp 2.000/pcs kak.\nTotal: 8 rim x 500 x Rp 2.000 = Rp 8.000.000');
    const out = await verifyFit(summed, PROMPT, 'box ivory 8 rim jadi total berapa', { judge: okJudge().judge, regenerate: vi.fn(async () => summed) });
    expect(out.confidence).toBe('high');
    expect(out.totalForTeam).toBe(true);
    expect(out.message).toBe('Box Ivory 270 gsm cetak full color 8 rim harganya Rp 2.000/pcs kak.');
  });

  it('the judge gets the customer situation as is - no buyer-type line', async () => {
    const { judge, calls } = okJudge();
    await verifyFit(draft('Box Ivory 270 gsm cetak full color ready kak, Rp 2.000/pcs.'), PROMPT, 'box ivory ada?', { judge, regenerate: noRegenerate });
    expect(calls).toEqual(['box ivory ada?']);
  });

  it('a "Totalnya" the model added up without the tool goes to the team, the tier price is sent', async () => {
    const summed = draft('Box Ivory 270 gsm cetak full color 8 rim harganya Rp 2.000/pcs kak.\nTotalnya Rp 8.000.000');
    const out = await verifyFit(summed, PROMPT, 'box ivory 8 rim jadi berapa', { judge: okJudge().judge, regenerate: vi.fn(async () => summed) });
    expect(out).toMatchObject({ confidence: 'high', totalForTeam: true, message: 'Box Ivory 270 gsm cetak full color 8 rim harganya Rp 2.000/pcs kak.' });
  });

  // Before the client imports a catalog the prompt has no catalog block; a figure is then backed by
  // nothing but the tool, and the price check must not be skipped along with the judge.
  describe('with no catalog block in the prompt', () => {
    const BARE = '## Identity\nKamu adalah CS Imperial Indopack.';

    it('does not send a price the tool did not return - it is repaired, then handed off', async () => {
      const quoting = draft('Box Ivory 20x20x7,5 Rp 2.000/pcs kak.');
      const { judge, calls } = okJudge();
      const regenerate = vi.fn(async () => quoting);
      const out = await verifyFit(quoting, BARE, 'harga box ivory?', { judge, regenerate });
      expect(regenerate).toHaveBeenCalledTimes(2);
      expect(regenerate.mock.calls[0]![0]).toContain('hitung_harga');
      expect(out).toMatchObject({ confidence: 'low', message: '' });
      expect(calls).toHaveLength(0);
    });

    it('sends a price the tool returned, and a reply with no price, as they are', async () => {
      const { judge, calls } = okJudge();
      const quote = draft('Box Ivory 20x20x7,5, 8 rim: Rp 2.000/pcs, total Rp 8.000.000 kak.', TOOL);
      expect(await verifyFit(quote, BARE, 'box ivory 8 rim', { judge, regenerate: noRegenerate })).toBe(quote);
      const ask = draft('Boleh tahu ukurannya kak?');
      expect(await verifyFit(ask, BARE, 'box ivory', { judge, regenerate: noRegenerate })).toBe(ask);
      expect(calls).toHaveLength(0);
    });
  });
});
