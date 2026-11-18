/**
 * other-brands.test.ts
 *
 * A brand that is not ours, said as a brand (services/otherBrands.ts, replyChecks.verifyReplyOtherBrand).
 * Live 2026-10-22: a SOLID padlock became "gembok 60mm solid yang kokoh", and replayed with only the
 * prompt rule a typed "gembok solid" got "Gembok 60mm ada kok" 1 run in 2.
 */
import { describe, it, expect } from 'vitest';
import { brandsNamedInText, notOurBrands, otherBrandNote } from '../src/services/otherBrands.js';
import { verifyReplyOtherBrand } from '../src/services/replyChecks.js';

describe('brands the customer names', () => {
  it('"merk X" for any X that is not ours', () => {
    expect(brandsNamedInText('ada palu kambing merk stanley yang 16 oz?')).toEqual(['Stanley']);
    expect(brandsNamedInText('handle pisah merek Dekson warna hitam')).toEqual(['Dekson']);
    expect(brandsNamedInText('mau yang merk blossom aja')).toEqual([]);
    expect(brandsNamedInText('merek d-xplore ada?')).toEqual([]);
  });
  it('a question about brands is not a brand', () => {
    for (const m of ['merk apa aja yang ada?', 'ada merek lain?', 'brand lokal ada?', 'merk yang bagus apa kak']) {
      expect(brandsNamedInText(m)).toEqual([]);
    }
  });
  it('a known brand bare after the item, never "solid" as an adjective', () => {
    expect(brandsNamedInText('ada gembok solid yang 60mm kak?')).toEqual(['Solid']);
    expect(brandsNamedInText('kunci SOLID ada?')).toEqual(['SOLID']);
    expect(brandsNamedInText('pintu kayu solid, handle yang cocok apa?')).toEqual([]);
    expect(brandsNamedInText('mau handle yang solid dan kuat')).toEqual([]);
  });
  it('one brand once, however often it is named', () => {
    expect(brandsNamedInText('gembok solid, yang merk solid itu lho')).toEqual(['Solid']);
    expect(notOurBrands(['SOLID', 'Solid', 'Legacy', ' '])).toEqual(['SOLID']);
  });
});

describe('the reply must say the brand is not ours', () => {
  const prompt = (brands: string[], source: 'foto' | 'pesan' = 'pesan') =>
    `--- INFORMASI MEREK ---\nMEREK SENDIRI (Legacy):\n- Blossom\n--- INFORMASI PELANGGAN ---\n${otherBrandNote(source, brands)}\n--- AKHIR INFORMASI PELANGGAN ---`;

  it('passes a reply that says so, from either side of the name', () => {
    expect(verifyReplyOtherBrand('Mohon maaf kak, gembok merek Solid belum ada di kami ya 🙏 Untuk 60mm ada Gembok Besi Jacket dari Blossom.', prompt(['Solid'])).ok).toBe(true);
    expect(verifyReplyOtherBrand('Kami belum menyediakan merek SOLID kak, tapi ada gembok 60mm dari Blossom.', prompt(['SOLID'], 'foto')).ok).toBe(true);
  });
  it('repairs a reply that skips the brand, or reads it as "kokoh"', () => {
    const skipped = verifyReplyOtherBrand('Gembok 60mm ada kok, Kak Budi! 😊 Ada dua pilihan yang siap stok.', prompt(['Solid']));
    expect(skipped).toMatchObject({ ok: false, soft: true });
    expect(skipped.reason).toMatch(/merek Solid belum ada di kami/);
    expect(verifyReplyOtherBrand('Baik Kak, untuk gembok 60mm solid yang kokoh, kami punya 2 pilihan.', prompt(['SOLID'], 'foto')).ok).toBe(false);
  });
  it('every brand named must be answered', () => {
    const r = verifyReplyOtherBrand('Merek Solid belum ada di kami kak.', prompt(['Solid', 'Dekson']));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/^Dekson adalah merek lain/);
  });
  it('no note, no check - "MEREK SENDIRI" in the brand section is not a note', () => {
    expect(verifyReplyOtherBrand('Gembok 60mm ada kok kak.', '--- INFORMASI MEREK ---\nMEREK SENDIRI (Legacy):\n- Blossom').ok).toBe(true);
  });
});
