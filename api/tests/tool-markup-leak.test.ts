/**
 * tool-markup-leak.test.ts
 * UAT Run 3 (F-29 / Fix Plan R-16): the model wrote the next tool parameter into `message`, and
 * customers received '...",\n<parameter name="confidence">high' / '...low'. The second kind is a
 * complaint the model meant to hand off - the real `confidence` field was missing and defaulted to
 * "high", so it was answered instead. Both bodies are synthetic, in the shape the leak takes.
 */

import { describe, it, expect } from 'vitest';
import { extractFromToolInput } from '../src/services/aiLayer.js';
import { toWhatsAppMarkup } from '../src/services/whatsappSender.js';

// A priced answer, leaked into a "high" parameter.
const PRICED = 'Kertas Supreme 64 gsm kami tersedia cetak 1 atau 2 warna kak — logonya dicetak berulang di seluruh lembar. Untuk 10 rim ukuran 30 x 30: **Rp 185.000/rim**.\n\nSatu rim isinya 500 lembar, sudah termasuk ongkir.\n\nUntuk warna logonya, saya pastikan ke tim ya. Tapi sebelumnya, boleh tahu — kertasnya untuk bungkus nasi padang atau burger? Biar saya pastikan ukurannya pas 😊",\n<parameter name="confidence">high';
// A complaint - also carries the literal "\n" of the same JSON-string mode.
const COMPLAINT = 'Pak Budi, saya turut prihatin mendengarnya. Untuk box yang rusak saat diterima, saya teruskan keluhan ini ke tim kami ya. Mereka akan membantu mengecek kondisinya dan mencari solusi terbaik untuk Pak Budi.\\n\\nSebelumnya, boleh saya tahu box yang mana yang rusak? Ukuran, jumlah, atau ada fotonya? Itu akan membantu tim kami untuk lebih cepat menangani masalahnya.",\n<parameter name="confidence">low';

describe('a tool call written into the message text', () => {
  it('is cut off the message, which then ends where the reply ends', () => {
    const r = extractFromToolInput({ message: PRICED, fit_basis: [] });
    expect(r.message.endsWith('Biar saya pastikan ukurannya pas 😊')).toBe(true);
    expect(r.confidence).toBe('high');
  });

  it('keeps the confidence it carried - the complaint is handed off, not answered', () => {
    const r = extractFromToolInput({ message: COMPLAINT, fit_basis: [] });
    expect(r.confidence).toBe('low');
    expect(r.message.endsWith('menangani masalahnya.')).toBe(true);
  });

  it('never overrides a field the model did send as a parameter', () => {
    expect(extractFromToolInput({ message: COMPLAINT, confidence: 'high' }).confidence).toBe('high');
  });

  it('leaves an ordinary reply alone, quotes and inch marks included', () => {
    const message = 'Paper bag 10" ada kak, harganya Rp 2.500/pcs. Mau yang "kraft"?';
    expect(extractFromToolInput({ message, confidence: 'high' }).message).toBe(message);
  });

  it('never reaches WhatsApp, whichever path the text took', () => {
    expect(toWhatsAppMarkup(PRICED).endsWith('ukurannya pas 😊')).toBe(true);
    const complaint = toWhatsAppMarkup(COMPLAINT);
    expect(complaint).not.toContain('<parameter');
    expect(complaint).toContain('Pak Budi.\n\nSebelumnya');
    expect(complaint.endsWith('menangani masalahnya.')).toBe(true);
  });
});
