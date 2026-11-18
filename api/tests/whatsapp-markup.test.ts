/**
 * whatsapp-markup.test.ts
 * WhatsApp bold is *one* asterisk, Markdown's is two. The model writes Markdown, so `**Box Nasi**`
 * would reach customers with the asterisks showing. Pure - no DB, no API key.
 */

import { describe, it, expect } from 'vitest';
import { toWhatsAppMarkup } from '../src/services/whatsappSender.js';

describe('toWhatsAppMarkup', () => {
  it('converts Markdown bold to WhatsApp bold', () => {
    expect(toWhatsAppMarkup('**Box Nasi** - Untuk katering, acara, atau jualan harian?'))
      .toBe('*Box Nasi* - Untuk katering, acara, atau jualan harian?');
  });

  it('converts every bold run in a multi-line reply', () => {
    const input = '**Box Nasi** - Untuk katering?\n**Kertas Bungkus** - Untuk nasi padang?';
    expect(toWhatsAppMarkup(input)).toBe('*Box Nasi* - Untuk katering?\n*Kertas Bungkus* - Untuk nasi padang?');
  });

  it('leaves text that is already WhatsApp bold alone', () => {
    expect(toWhatsAppMarkup('*Kertas Supreme* ini Rp 185.000/rim')).toBe('*Kertas Supreme* ini Rp 185.000/rim');
  });

  it('leaves a lone stray ** alone rather than swallowing the rest of the message', () => {
    expect(toWhatsAppMarkup('Harga ** belum termasuk ongkir')).toBe('Harga ** belum termasuk ongkir');
  });

  it('does not span a newline', () => {
    expect(toWhatsAppMarkup('**Box Nasi\nKertas Bungkus**')).toBe('**Box Nasi\nKertas Bungkus**');
  });

  it('passes ordinary prose through untouched', () => {
    const msg = 'Kita coba cek dengan tim dulu ya kak 🙏';
    expect(toWhatsAppMarkup(msg)).toBe(msg);
  });

  // UAT F-13: "...tidak boleh dibagikan.\n\nYang bisa saya bantu..." with the backslashes visible.
  it('turns a literal backslash-n into a real line break', () => {
    expect(toWhatsAppMarkup('Baik kak.\\n\\nKapan pun siap, kabari ya.')).toBe('Baik kak.\n\nKapan pun siap, kabari ya.');
  });

  // UAT F-04: an em dash in a WhatsApp chat reads as machine-written.
  it('replaces em and en dashes with a plain hyphen, without joining lines', () => {
    expect(toWhatsAppMarkup('boleh tahu ya kak — ini untuk makanan apa?')).toBe('boleh tahu ya kak - ini untuk makanan apa?');
    expect(toWhatsAppMarkup('ukuran 20–25 cm')).toBe('ukuran 20 - 25 cm');
    expect(toWhatsAppMarkup('Pilihan:\n— Ivory\n— Kraft')).toBe('Pilihan:\n- Ivory\n- Kraft');
  });

  it('leaves real newlines and hyphenated words alone', () => {
    const msg = 'Kertas anti-minyak ready kak.\nMau yang 30 x 30?';
    expect(toWhatsAppMarkup(msg)).toBe(msg);
  });
});

// The model can double-escape its whole JSON message, and the stored text then comes back with
// literal \" marks and a closing quote of its own.
describe('toWhatsAppMarkup - leftovers of a double-escaped message', () => {
  it('unescapes \\" and drops the closing quote, keeping the inch marks', () => {
    const raw = 'Halo kak! 😊 Sebelumnya, dengan siapa saya terhubung ya?\\n\\nUntuk box dan paper bag 10\\", kami punya beberapa pilihan.\\n- Paper bag 10\\" untuk takeaway atau hampers?\\n\\nSetelah itu saya bisa kasih harga yang tepat untuk kakak."';
    expect(toWhatsAppMarkup(raw)).toBe(
      'Halo kak! 😊 Sebelumnya, dengan siapa saya terhubung ya?\n\nUntuk box dan paper bag 10", kami punya beberapa pilihan.\n- Paper bag 10" untuk takeaway atau hampers?\n\nSetelah itu saya bisa kasih harga yang tepat untuk kakak.'
    );
  });

  it('drops a lone closing quote after an emoji', () => {
    expect(toWhatsAppMarkup('Biar aku bisa bantu carikan kemasan yang paling pas buat kakak 😊"'))
      .toBe('Biar aku bisa bantu carikan kemasan yang paling pas buat kakak 😊');
  });

  it.each([
    'Tersedia ukuran 10"',
    'Paper bag 8½"',
    'Box 8" ready, modelnya "Kraft"',
    'Namanya "Supreme", ukurannya 12"',
  ])('leaves real quotes and inch marks alone: %s', (m) => expect(toWhatsAppMarkup(m)).toBe(m));

  it('turns a Markdown link into the bare url WhatsApp links by itself', () => {
    expect(toWhatsAppMarkup('kunjungi website kami di [www.example.co.id](https://www.example.co.id) ya'))
      .toBe('kunjungi website kami di https://www.example.co.id ya');
    expect(toWhatsAppMarkup('lihat di [toko Shopee kami](https://shopee.co.id/contoh_kemasan)'))
      .toBe('lihat di toko Shopee kami https://shopee.co.id/contoh_kemasan');
  });
});
