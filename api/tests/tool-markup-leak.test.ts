/**
 * tool-markup-leak.test.ts
 * UAT Run 3 (F-29 / Fix Plan R-16): the model wrote the next tool parameter into `message`, and two
 * customers received '...",\n<parameter name="confidence">high' / '...low'. The second was a rust
 * complaint the model meant to hand off - the real `confidence` field was missing and defaulted to
 * "high", so it was answered instead. Both bodies are verbatim from legacy_prod_20260910.
 */

import { describe, it, expect } from 'vitest';
import { extractFromToolInput } from '../src/services/aiLayer.js';
import { toWhatsAppMarkup } from '../src/services/whatsappSender.js';

// B-09, 13:55:22
const B09 = 'Handle Newton kami tersedia dalam beberapa pilihan warna kak — BNSN, SNCP, dan SS. Harganya sama untuk ketiganya: **Rp 294.000/Set** (untuk dipakai sendiri).\n\nSatu set sudah lengkap dengan handle kanan-kiri, body kunci, silinder, dan anak kunci. Cocok untuk pintu utama atau pintu besar di rumah.\n\nUntuk warna yang Pak Budi maksud, saya pastikan ke tim kodenya yang mana ya. Tapi sebelumnya, boleh tahu — pintunya untuk pintu utama rumah, atau pintu kamar? Biar saya pastikan ukurannya pas 😊",\n<parameter name="confidence">high';
// E-05, 14:13:47 - also carries the literal "\n" of the same JSON-string mode.
const E05 = 'Pak Budi, saya turut prihatin mendengarnya. Untuk kasus karat pada engsel yang sudah dibeli, saya teruskan keluhan ini ke tim kami ya. Mereka akan membantu mengecek kondisinya dan mencari solusi terbaik untuk Pak Budi.\\n\\nSebelumnya, boleh saya tahu engsel yang mana yang berkarat? Tipe, ukuran, atau ada fotonya? Itu akan membantu tim kami untuk lebih cepat menangani masalahnya.",\n<parameter name="confidence">low';

describe('a tool call written into the message text', () => {
  it('is cut off the message, which then ends where the reply ends', () => {
    const r = extractFromToolInput({ message: B09, fit_basis: [], customer_type: 'end_user' });
    expect(r.message.endsWith('Biar saya pastikan ukurannya pas 😊')).toBe(true);
    expect(r.confidence).toBe('high');
  });

  it('keeps the confidence it carried - the complaint is handed off, not answered', () => {
    const r = extractFromToolInput({ message: E05, fit_basis: [], customer_type: 'unknown' });
    expect(r.confidence).toBe('low');
    expect(r.message.endsWith('menangani masalahnya.')).toBe(true);
  });

  it('never overrides a field the model did send as a parameter', () => {
    expect(extractFromToolInput({ message: E05, confidence: 'high' }).confidence).toBe('high');
  });

  it('leaves an ordinary reply alone, quotes and inch marks included', () => {
    const message = 'Engsel 4" ada kak, harganya Rp 59.000/Set. Mau yang "SN"?';
    expect(extractFromToolInput({ message, confidence: 'high' }).message).toBe(message);
  });

  it('never reaches WhatsApp, whichever path the text took', () => {
    expect(toWhatsAppMarkup(B09).endsWith('ukurannya pas 😊')).toBe(true);
    const e05 = toWhatsAppMarkup(E05);
    expect(e05).not.toContain('<parameter');
    expect(e05).toContain('Pak Budi.\n\nSebelumnya');
    expect(e05.endsWith('menangani masalahnya.')).toBe(true);
  });
});
