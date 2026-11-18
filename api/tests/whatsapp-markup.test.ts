/**
 * whatsapp-markup.test.ts
 * WhatsApp bold is *one* asterisk, Markdown's is two. The model writes Markdown, so `**Engsel**`
 * reached customers with the asterisks showing (live 2026-09-09). Pure - no DB, no API key.
 */

import { describe, it, expect } from 'vitest';
import { toWhatsAppMarkup } from '../src/services/whatsappSender.js';

describe('toWhatsAppMarkup', () => {
  it('converts Markdown bold to WhatsApp bold', () => {
    expect(toWhatsAppMarkup('**Engsel** - Untuk pintu, jendela, atau lemari?'))
      .toBe('*Engsel* - Untuk pintu, jendela, atau lemari?');
  });

  it('converts every bold run in a multi-line reply', () => {
    const input = '**Engsel** - Untuk pintu?\n**Grendel** - Untuk jendela?';
    expect(toWhatsAppMarkup(input)).toBe('*Engsel* - Untuk pintu?\n*Grendel* - Untuk jendela?');
  });

  it('leaves text that is already WhatsApp bold alone', () => {
    expect(toWhatsAppMarkup('*Engsel* ini Rp 42.500/Lsn')).toBe('*Engsel* ini Rp 42.500/Lsn');
  });

  it('leaves a lone stray ** alone rather than swallowing the rest of the message', () => {
    expect(toWhatsAppMarkup('Harga ** belum termasuk ongkir')).toBe('Harga ** belum termasuk ongkir');
  });

  it('does not span a newline', () => {
    expect(toWhatsAppMarkup('**Engsel\nGrendel**')).toBe('**Engsel\nGrendel**');
  });

  it('passes ordinary prose through untouched', () => {
    const msg = 'Kita coba cek dengan tim dulu ya kak 🙏';
    expect(toWhatsAppMarkup(msg)).toBe(msg);
  });

  // UAT F-13: "...tidak boleh dibagikan.\n\nYang bisa saya bantu..." with the backslashes visible.
  it('turns a literal backslash-n into a real line break', () => {
    expect(toWhatsAppMarkup('Baik kak.\\n\\nKapan pun siap, kabari ya.')).toBe('Baik kak.\n\nKapan pun siap, kabari ya.');
  });

  // UAT F-04: "pintu yang mana ya — pintu utama ..." reads as machine-written.
  it('replaces em and en dashes with a plain hyphen, without joining lines', () => {
    expect(toWhatsAppMarkup('boleh tahu ya kak — ini untuk pintu yang mana?')).toBe('boleh tahu ya kak - ini untuk pintu yang mana?');
    expect(toWhatsAppMarkup('ukuran 2–3 inch')).toBe('ukuran 2 - 3 inch');
    expect(toWhatsAppMarkup('Pilihan:\n— Newton\n— Sevilla')).toBe('Pilihan:\n- Newton\n- Sevilla');
  });

  it('leaves real newlines and hyphenated words alone', () => {
    const msg = 'Engsel anti-karat ready kak.\nMau yang 3 inch?';
    expect(toWhatsAppMarkup(msg)).toBe(msg);
  });
});

// UAT Run 2: the model double-escaped its whole JSON message now and then, and the stored text came
// back with literal \" inch marks and a closing quote of its own.
describe('toWhatsAppMarkup - leftovers of a double-escaped message', () => {
  it('D-07: unescapes \\" and drops the closing quote, keeping the inch marks', () => {
    const raw = 'Halo kak! 😊 Sebelumnya, dengan siapa saya terhubung ya?\\n\\nUntuk engsel dan grendel 4\\", kami punya beberapa pilihan.\\n- Grendel 4\\" untuk pintu atau pagar?\\n\\nSetelah itu saya bisa kasih harga yang tepat untuk kakak."';
    expect(toWhatsAppMarkup(raw)).toBe(
      'Halo kak! 😊 Sebelumnya, dengan siapa saya terhubung ya?\n\nUntuk engsel dan grendel 4", kami punya beberapa pilihan.\n- Grendel 4" untuk pintu atau pagar?\n\nSetelah itu saya bisa kasih harga yang tepat untuk kakak.'
    );
  });

  it('D-11: drops a lone closing quote after an emoji', () => {
    expect(toWhatsAppMarkup('Biar aku bisa bantu carikan produk yang paling pas buat kakak 😊"'))
      .toBe('Biar aku bisa bantu carikan produk yang paling pas buat kakak 😊');
  });

  it.each([
    'Tersedia ukuran 4"',
    'Engsel tipis 2½"',
    'Engsel 4" ready, tipenya "Vintage"',
    'Namanya "Newton", ukurannya 3"',
  ])('leaves real quotes and inch marks alone: %s', (m) => expect(toWhatsAppMarkup(m)).toBe(m));

  it('D-01: turns a Markdown link into the bare url WhatsApp links by itself', () => {
    expect(toWhatsAppMarkup('kunjungi website kami di [www.previous-client.example](https://www.previous-client.example) ya'))
      .toBe('kunjungi website kami di https://www.previous-client.example ya');
    expect(toWhatsAppMarkup('lihat di [toko Shopee kami](https://shopee.co.id/vintage_indo)'))
      .toBe('lihat di toko Shopee kami https://shopee.co.id/vintage_indo');
  });
});
