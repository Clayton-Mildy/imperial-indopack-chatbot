/**
 * reply-checks.test.ts
 * The deterministic reply checks: totals cut for the team, and the wording the prompt forbids
 * (lecturing, hedged "not carried", photo claims, internal terms, false "sudah dikirim", name
 * questions). Pure — no DATABASE_URL, no API key. The tiered price check has its own file
 * (reply-checks-tiered.test.ts).
 */

import { describe, it, expect } from 'vitest';
import { withoutInventedTotals, verifyReplyTone, verifyReplyNotCarried, verifyReplyPhotoClaim, verifyReplyMeta, verifyReplyCatalogClaim, verifyReplyOpener, verifyReplyFirstGreeting, verifyReplyNameRepeat, verifyReplyNotCarriedCloses, nameGivenIn, ASKS_NAME_RE, verifyReplyUrls, verifyReplyOrderStatus, urlsIn } from '../src/services/replyChecks.js';
import { SYSTEM_PROMPT_BEHAVIORAL_RULES } from '../src/domain/constants.js';

describe('withoutInventedTotals', () => {
  it('cuts total lines and a total section, keeping the item prices', () => {
    const msg = [
      'Kertas Supreme 30 x 30: Rp 185.000/rim',
      'Box nasi 20x20x7,5: Rp 1.800/pcs',
      '',
      '**TOTAL PER OUTLET:**',
      '- Box + kertas: Rp 520.000',
      '- Kertas saja: Rp 150.500',
      '',
      'Grand total 10 outlet: Rp 6.705.000',
      '---',
    ].join('\n');
    expect(withoutInventedTotals(msg, [520000, 150500, 6705000])).toBe('Kertas Supreme 30 x 30: Rp 185.000/rim\nBox nasi 20x20x7,5: Rp 1.800/pcs');
  });

  it('refuses a misquoted price that is not a total', () => {
    expect(withoutInventedTotals('Kertas Supreme 30 x 30: Rp 184.000/rim\nTotal: Rp 1.840.000', [184000, 1840000])).toBeNull();
  });
});

// Nothing was sent, yet a reply said it had, twice, and then sent the customer looking through his
// own folders.
describe('verifyReplyCatalogClaim — no "sudah dikirim" unless a file went out this turn', () => {
  it.each([
    'Baik Kak Budi, daftar harga semua merek sudah saya kirimkan ya 😊 Setelah lihat-lihat, ada yang menarik?',
    'Baik Kak Budi, katalognya sudah saya kirim ulang ya 😊 Semoga kali ini bisa masuk dengan lancar.',
    'Price list Kertas Supreme sudah terkirim ya kak.',
    'Wah, mungkin belum masuk ya Kak. Coba cek lagi di chat atau folder file.',
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

// "Tidak ada kewajiban kontrak atau syarat administratif yang rumit" must never reach a customer.
describe('verifyReplyMeta - internal terms', () => {
  it('rejects "kontrak" and "SOP"', () => {
    const out = verifyReplyMeta('*Tidak ada kewajiban kontrak atau syarat administratif yang rumit* 😊');
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('"kontrak"');
    expect(verifyReplyMeta('Sesuai SOP kami, minimal 5 rim ya kak.').ok).toBe(false);
  });

  it('leaves "sop" in lowercase and words that merely contain the letters alone', () => {
    expect(verifyReplyMeta('Wah, jualan sop ya kak? Kertas bungkusnya minimal 5 rim ya.').ok).toBe(true);
    expect(verifyReplyMeta('Kontraktor katering juga banyak yang ambil box di kami kak.').ok).toBe(true);
  });

  // A repaired reply must not open with the repair instruction read back to the customer.
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

// The reply to the customer's name must move on to the order, not back to an open "ada yang bisa saya
// bantu carikan?". Client 2026-11-02: a greeting with no need stated gets "Ada yang bisa saya bantu?" -
// and only that, without the name question tacked on.
describe('verifyReplyFirstGreeting - the open question alone, no name question with it', () => {
  it('repairs (soft) the open question asked together with the name', () => {
    const out = verifyReplyFirstGreeting('Haloo siang kak! 😊 Iya betul, saya Admin dari Kertas Supreme. Ada yang bisa saya bantu kak? Sebelumnya, dengan siapa saya terhubung ya?');
    expect(out.ok).toBe(false);
    expect(out.soft).toBe(true);
  });
  it.each([
    'Haloo siang kak! 😊 Iya betul, saya Admin dari Kertas Supreme. Ada yang bisa saya bantu kak?',
    'Halo kak! Ada kok, kami punya box nasi ivory 😊 Sebelumnya, dengan siapa saya terhubung ya?',
  ])('passes: %s', (m) => expect(verifyReplyFirstGreeting(m).ok).toBe(true));
});

describe('verifyReplyOpener - on an opening turn the next question is the name, then what they pack', () => {
  it('rejects the open question that replaces them, and repairs towards the order details', () => {
    const out = verifyReplyOpener('Salam kenal, Kak Budi! 😊 Ada yang bisa saya bantu carikan hari ini?');
    expect(out.ok).toBe(false);
    expect(out).not.toHaveProperty('askBuyerType');
    expect(out.reason).toContain('barang apa yang mau dikemas');
    expect(out.reason).not.toMatch(/tipe pembeli|dipakai sendiri|dijual lagi/);
    expect(verifyReplyOpener('Halo! Selamat datang di Kertas Supreme 😊 Ada yang bisa saya bantu carikan hari ini?').ok).toBe(false);
  });

  it('allows it next to the name question or the question of what they pack', () => {
    expect(verifyReplyOpener('Halo! 😊 Ada yang bisa saya bantu carikan hari ini? Sebelumnya, dengan siapa saya terhubung ya?').ok).toBe(true);
    expect(verifyReplyOpener('Salam kenal, Kak Budi 😊 Ada yang bisa saya bantu? Kemasannya untuk makanan apa kak?').ok).toBe(true);
    expect(verifyReplyOpener('Ada yang bisa saya bantu kak? Mau dikemas untuk apa?').ok).toBe(true);
  });

  it('leaves other questions alone', () => {
    expect(verifyReplyOpener('Wah, itu nggak bisa aku bagikan ya kak 🙏 Ada kemasan yang lagi dicari?').ok).toBe(true);
    expect(verifyReplyOpener('Salam kenal, Kak Budi 😊 Kertasnya untuk membungkus apa kak?').ok).toBe(true);
  });
});

// A photo the comparison called only "mirip" must not become "Iya kak, ini memang produk kami".
describe('verifyReplyPhotoClaim', () => {
  const SIMILAR = 'PERBANDINGAN FOTO: foto pelanggan MIRIP foto produk kami BOX KUE IVORY 20X20, tapi belum pasti model yang sama.';
  const NONE = 'PERBANDINGAN FOTO: foto pelanggan sudah dibandingkan dengan foto produk A, B dan TIDAK ada yang sama.';
  it('asks for a repair when "mirip" is told as "it is ours"', () => {
    expect(verifyReplyPhotoClaim('Iya kak, ini memang produk kami - Box Kue Ivory 20x20', SIMILAR)).toMatchObject({ ok: false, soft: true });
    expect(verifyReplyPhotoClaim('Ini sama persis dengan box kue ivory kami kak', NONE)).toMatchObject({ ok: false, soft: true });
    expect(verifyReplyPhotoClaim('Ini cocok dengan produk kami - Lunch Box Kraft', NONE)).toMatchObject({ ok: false, soft: true });
  });
  it('passes a question, and any reply on a turn without a photo verdict', () => {
    expect(verifyReplyPhotoClaim('Apakah yang dimaksud Box Kue Ivory 20x20 ini kak?', SIMILAR).ok).toBe(true);
    expect(verifyReplyPhotoClaim('Saya cek dulu apakah kami punya box yang sama persis seperti di foto', NONE).ok).toBe(true);
    expect(verifyReplyPhotoClaim('Iya kak, ini memang produk kami', 'no photo here').ok).toBe(true);
    expect(verifyReplyPhotoClaim('Iya kak, ini memang produk kami', 'PERBANDINGAN FOTO: foto pelanggan SAMA dengan foto produk kami X.').ok).toBe(true);
  });
});

// An item we do not carry gets a plain no - not "sepertinya", and no questions about what it is for.
describe('verifyReplyNotCarried', () => {
  it.each([
    'Untuk gelas plastik, sepertinya belum ada di kami ya.',
    'Gelas plastik belum ada di kami. Kalau boleh tahu, gelas plastik ini untuk keperluan apa ya?',
    'Styrofoam tidak ada di kami kak, mungkin ada alternatif lain yang bisa saya carikan?',
  ])('asks for a repair: %s', (m) => expect(verifyReplyNotCarried(m)).toMatchObject({ ok: false, soft: true }));
  it.each([
    'Mohon maaf kak, gelas plastik belum ada di kami ya 🙏 Kalau ada kemasan lain yang sedang dicari, dengan senang hati saya bantu.',
    // out of stock is not "not carried": the question about what it wraps is part of choosing a size
    'Yang 25 x 25-nya belum ada kak, yang ready 30 x 30. Untuk bungkus apa ya kak?',
    'Yang 25 x 25 stoknya belum ada kak, yang ready 30 x 30. Untuk apa ya kak?',
    // the allowed hedge about FIT
    'Sepertinya belum ada yang cocok untuk kue basah kak, saya pastikan dulu ya.',
    'Ada kak, box kue ivory 20x20. Untuk kue apa ya kak?',
  ])('passes: %s', (m) => expect(verifyReplyNotCarried(m).ok).toBe(true));
});

describe('verifyReplyTone', () => {
  it('flags the lecturing sentence, as a soft rewrite - never a hand-off on its own', () => {
    const r = verifyReplyTone('Baik Kak Budi, aku tekankan lagi: Kertas Supreme hanya tersedia dalam ukuran 30 x 30 dan 35 x 35');
    expect(r.ok).toBe(false);
    expect(r.soft).toBe(true);
    expect(r.reason).toMatch(/confidence "low"/);
  });

  it.each([
    'Saya tegaskan, varian itu tidak ada ya kak.',
    'Perlu saya tekankan bahwa ukurannya hanya 30 x 30 dan 35 x 35.',
    'Seperti yang sudah saya sampaikan, box ini tidak ada yang ukuran 50x50.',
    'Seperti tadi aku jelaskan, warnanya cuma ivory.',
  ])('flags lecturing phrasing: %s', (m) => expect(verifyReplyTone(m).ok).toBe(false));

  it.each([
    'Mohon maaf kak, untuk box putih di kami adanya Box Ivory ukuran 20x20x7,5 ya kak.',
    'Seperti yang kakak sebutkan, untuk nasi padang ya kak.',
    'Coba saya tanyakan dulu ke tim ya kak.',
    'Terima kasih sekali lagi, saya catat pesanannya ya kak.',
  ])('lets ordinary replies through: %s', (m) => expect(verifyReplyTone(m).ok).toBe(true));
});

it('tells the model to hand off, not re-explain, when a customer insists on a variant we lack', () => {
  expect(SYSTEM_PROMPT_BEHAVIORAL_RULES).toMatch(/TETAP meminta varian yang sama[^\n]*confidence "low"/);
  expect(SYSTEM_PROMPT_BEHAVIORAL_RULES).toMatch(/Mohon maaf kak, untuk <yang diminta> di kami adanya/);
  // A customer's word can name more than one product ("box putih" can be any ivory box).
  expect(SYSTEM_PROMPT_BEHAVIORAL_RULES).toMatch(/LEBIH DARI SATU produk/);
});

// Team, 2026-11-08: the name asked again after "Dengan Rudi ka".
describe('the name the customer already gave', () => {
  const asked = { role: 'assistant', content: 'Halo Kak 😊 Sebelumnya, dengan siapa saya terhubung ya?' };

  it.each([
    ['Dengan Rudi ka', 'Rudi'],
    ['Baik\nSaya Bang Andi dari Sidoarjo', 'Andi'],
    ['nama saya Budi kak', 'Budi'],
    ['oh iya, sama Dewi', 'Dewi'],
  ])('reads %j as a name', (answer, name) => {
    expect(nameGivenIn([asked, { role: 'user', content: answer }])).toBe(name);
  });

  it.each(['Baik kk', 'saya mau tanya box nasi', 'Saya Mau order', 'dengan harga berapa?', 'Untuk lokasi malang ka'])(
    'does not read %j as a name', (answer) => {
      expect(nameGivenIn([asked, { role: 'user', content: answer }])).toBeNull();
    });

  it('only counts an answer to the name question', () => {
    expect(nameGivenIn([{ role: 'user', content: 'Dengan Rudi ka' }, asked])).toBeNull();
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
    expect(verifyReplyNameRepeat('Baik kak, di Malang ya 😊 Boleh tahu nama kakak siapa?', 'Rudi')).toMatchObject({ ok: false, soft: true });
    expect(verifyReplyNameRepeat('Salam kenal, Kak Rudi 😊 Kemasannya untuk jualan apa kak?', 'Rudi').ok).toBe(true);
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

// Final review I4(a), spec 4: a link in the reply text went out unchecked - a made-up forms.gle PO link,
// a web-search result. The PO link is sent by code on its own line; the model writes no URL, except one
// the customer sent itself (or, if it does write it, the configured PO form).
describe('verifyReplyUrls', () => {
  const PO = 'https://forms.gle/ContohPO123';

  it.each([
    'Silakan isi form PO di https://forms.gle/AbCdEf ya kak',
    'Bisa cek di www.contoh-kemasan.com kak',
    'Info lengkap di imperialindopack.co.id ya',
    'Lihat contohnya di bit.ly/contohbox',
  ])('rejects a link the customer did not send: %s', (msg) => {
    const v = verifyReplyUrls(msg, [PO], 'mau box nasi 20x20');
    expect(v.ok).toBe(false);
    expect(v.reason).toContain(urlsIn(msg)[0]!);
    expect(v.reason).toMatch(/send_po_form/);
  });

  it('accepts a link the customer sent, however it is written back', () => {
    const customer = 'ini toko saya kak https://instagram.com/ContohToko dan tokopedia.com/contohtoko';
    expect(verifyReplyUrls('Siap kak, sudah saya lihat https://instagram.com/ContohToko.', [], customer).ok).toBe(true);
    expect(verifyReplyUrls('Tokonya di https://www.tokopedia.com/contohtoko/ ya kak', [], customer).ok).toBe(true);
  });

  it('accepts the configured PO form, never the placeholder', () => {
    expect(verifyReplyUrls(`Form PO-nya: ${PO}`, [PO], '').ok).toBe(true);
    expect(verifyReplyUrls('Form PO-nya: https://forms.gle/REPLACE-ME', [], '').ok).toBe(false);
  });

  it('accepts both configured PO forms (cetak and plano), and still no other link', () => {
    const PLANO = 'https://forms.gle/ContohPlano456';
    expect(verifyReplyUrls(`Cetak: ${PO}\nPlano: ${PLANO}`, [PO, PLANO], '').ok).toBe(true);
    expect(verifyReplyUrls(`Plano: ${PLANO}/`, [PO, PLANO], '').ok).toBe(true);
    expect(verifyReplyUrls(`Plano: ${PLANO} atau https://forms.gle/Karangan`, [PO, PLANO], '').ok).toBe(false);
  });

  it.each([
    'Harganya Rp 1.800.000 ya kak',
    'Ukuran 20x20x7.5 cm ready kak',
    'Bisa email ke contoh@gmail.com kak',
    'Daftar Harga Kertas Supreme.pdf sudah saya kirim',
    'Siap kak, ditunggu ya.Terima kasih',
  ])('finds no link in: %s', (msg) => {
    expect(urlsIn(msg)).toEqual([]);
    expect(verifyReplyUrls(msg, [], '').ok).toBe(true);
  });
});

// Final review I4(b), spec 4: "the bot says an order is confirmed, paid or in production".
describe('verifyReplyOrderStatus', () => {
  it.each([
    'Pesanan kakak sudah dikonfirmasi ya',
    'Orderannya sudah terkonfirmasi kak',
    'Pembayarannya sudah kami terima, terima kasih kak',
    'Pembayaran diterima ya kak',
    'Sudah lunas ya kak 🙏',
    'Transfernya sudah masuk kak',
    'Pesanannya sudah dibayar ya kak',
    'Pesanan kakak sedang diproduksi',
    'Saat ini sedang dalam proses produksi ya kak',
    'Kertasnya sedang dicetak kak',
    'Pesanan kakak sudah proses produksi ya kak.',
    'Pesanannya sudah masuk produksi',
    'Barangnya sudah dikirim ya kak',
    'Pesanan sudah kami kirimkan kemarin',
    'Paketnya sedang dalam pengiriman kak',
  ])('rejects the claim: %s', (msg) => {
    const v = verifyReplyOrderStatus(msg);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/tim/);
    expect(v.reason).toMatch(/confidence "low"/);
  });

  it.each([
    'Apakah sudah dibayar kak?',
    'Pesanannya sudah dikonfirmasi belum kak?',
    'Setelah dibayar, pesanan diproduksi sekitar 7 hari kerja.',
    'Setelah pembayaran diterima, pesanan langsung kami produksi ya kak.',
    'Kalau sudah lunas, barangnya langsung kami kirim.',
    'Pesanan akan diproduksi setelah DP masuk.',
    'Nanti setelah dikonfirmasi tim, pesanan diproses.',
    'Pesanannya belum dikonfirmasi ya kak, tim kami cek dulu.',
    'Daftar harga Kertas Supreme sudah dikirim ya kak.',
    'Contoh desainnya sudah saya kirim di atas kak.',
    'Foto produknya sudah saya kirim ya.',
    'Form PO-nya saya kirim di bawah ya kak.',
    'Proses produksi sekitar 7-10 hari kerja kak.',
    'Pengiriman bisa ke seluruh Indonesia kak.',
    'Untuk sistem pembayaran (DP atau lunas) nanti tim kami yang informasikan ya kak.',
    'Bisa bayar lunas atau DP 50% kak.',
    'Pembayaran lunas sebelum barang dikirim ya kak.',
    'Kertas kami sudah diproduksi dengan bahan food grade kak.',
  ])('lets pass: %s', (msg) => expect(verifyReplyOrderStatus(msg).ok).toBe(true));

  // QA 2026-11-19 A8: promises in agreement recaps that passed the check.
  it.each([
    'Pesanannya udah fix ya kak 🙏',
    'Oke kak, order kakak sudah fix untuk 2.500 pcs.',
    'Logonya nanti langsung kami teruskan ke tim produksi ya kak',
    'Setelah form diisi, desainnya kami teruskan ke bagian produksi.',
    'Form PO-nya tinggal diisi dan dikirim balik ya kak',
    'Formnya diisi lalu dikirimkan kembali ke kami ya kak',
  ])('rejects the promise: %s', (msg) => {
    const v = verifyReplyOrderStatus(msg);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/send_po_form/);
  });

  it.each([
    'Kalau pesanannya sudah fix, tim kami yang hubungi ya kak.',
    'Ukurannya sudah fix 20 x 20 ya kak?',
    'Boleh kirim kembali fotonya kak, tadi tidak terbuka.',
    'Proses produksi sekitar 7-10 hari kerja kak.',
  ])('lets pass: %s', (msg) => expect(verifyReplyOrderStatus(msg).ok).toBe(true));
});

// Live 2026-11-20: "Halo, ini jualan apa ya?" got paper only, four chats in a row, with the prompt rule in place (Haiku).
describe('verifyReplyBothLines', () => {
  it.each(['Halo, ini jualan apa ya?', 'jual apa aja ya ini? untuk kegunaan apa', 'produknya apa aja kak', 'imperial indopack itu apa ya?', 'ada apa aja?', 'ini usaha apa ya'])(
    'asks what we sell: %s', async (q) => {
      const { verifyReplyBothLines } = await import('../src/services/replyChecks.js');
      const paperOnly = verifyReplyBothLines('Kami jual kertas bungkus cetak logo untuk nasi, kebab, dan burger.', q);
      expect(paperOnly.ok).toBe(false);
      expect(paperOnly.soft).toBe(true);
      expect(paperOnly.reason).toMatch(/box karton/);
      expect(verifyReplyBothLines('Kami jual box karton cetak untuk nasi box dan katering kak.', q).ok).toBe(false);
      expect(verifyReplyBothLines('Kami jual box karton cetak (nasi box, katering, box kue) dan kertas bungkus cetak logo untuk nasi, burger, kebab.', q).ok).toBe(true);
    });

  it.each(['berapa harga kertas nasi?', 'box 20x20 ada?', 'halo kak', 'gimana cara pesannya'])('ignores other questions: %s', async (q) => {
    const { verifyReplyBothLines } = await import('../src/services/replyChecks.js');
    expect(verifyReplyBothLines('Kami jual kertas bungkus cetak logo kak.', q).ok).toBe(true);
  });

  it('a reply that names no product line at all is not its business', async () => {
    const { verifyReplyBothLines } = await import('../src/services/replyChecks.js');
    expect(verifyReplyBothLines('Halo kak, ada yang bisa saya bantu?', 'jualan apa ya').ok).toBe(true);
  });
});
