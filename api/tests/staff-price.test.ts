import { describe, expect, it } from 'vitest';
import { priceFiguresIn, standingStaffPrice } from '../src/domain/staffPrice.js';

const bot = (body: string, metadata: Record<string, unknown> | null = null) => ({ role: 'assistant', body, senderName: null, metadata });
const staff = (body: string, senderName = 'Tim CS') => ({ role: 'assistant', body, senderName, metadata: null });
const customer = (body: string) => ({ role: 'user', body, senderName: null, metadata: null });

describe('priceFiguresIn', () => {
  it('reads Rp figures, informal juta/ribu figures and per-unit prices', () => {
    expect(priceFiguresIn('buletin ke 3 juta')).toEqual([3_000_000]);
    expect(priceFiguresIn('boleh 4,5 juta kak')).toEqual([4_500_000]);
    expect(priceFiguresIn('jadi 4.5jt ya')).toEqual([4_500_000]);
    expect(priceFiguresIn('185rb per rim')).toEqual([185_000]);
    expect(priceFiguresIn('kasih 185 ribu deh')).toEqual([185_000]);
    expect(priceFiguresIn('Rp 4.500.000 total')).toEqual([4_500_000]);
    expect(priceFiguresIn('Rp1.150/pcs')).toEqual([1_150]);
    expect(priceFiguresIn('Rp 8 juta')).toEqual([8_000_000]);
    expect(priceFiguresIn('1.150/pcs aja')).toEqual([1_150]);
    expect(priceFiguresIn('2.000 per lembar')).toEqual([2_000]);
  });

  it('reads no quantity, size or phone number as a price', () => {
    expect(priceFiguresIn('10 ribu pcs')).toEqual([]);
    expect(priceFiguresIn('5 rim, ukuran 20 x 20 x 7')).toEqual([]);
    expect(priceFiguresIn('2.500 pcs ya kak')).toEqual([]);
    expect(priceFiguresIn('wa 081234567890')).toEqual([]);
    expect(priceFiguresIn('halo kak')).toEqual([]);
  });
});

describe('standingStaffPrice', () => {
  it('is the staff message that named a price after the bot last quoted one', () => {
    const recent = [
      customer('box 20x20 2500 pcs berapa'),
      bot('Untuk 2.500 pcs harganya Rp 1.234/pcs, totalnya Rp 3.085.000 ya kak'),
      customer('bisa nego?'),
      bot('Kita coba cek dengan tim dulu ya kak'),
      staff('halo kak', 'Admin'),
      staff('buletin ke 3 juta'),
      customer('ya oke lah'),
    ];
    expect(standingStaffPrice(recent)).toEqual({ body: 'buletin ke 3 juta', figures: [3_000_000] });
  });

  it('is null once the bot quoted again after the staff price', () => {
    const recent = [
      staff('4,5 juta kak'),
      customer('kalau 5000 pcs?'),
      bot('Untuk 5.000 pcs harganya Rp 1.100/pcs ya kak'),
    ];
    expect(standingStaffPrice(recent)).toBeNull();
  });

  it('counts a bot turn that ran the price calculator as a quote even without a figure in the text', () => {
    const recent = [staff('Rp 4.500.000 ya kak'), bot('Siap kak', { priceCalls: [{ outcome: 'priced' }] })];
    expect(standingStaffPrice(recent)).toBeNull();
  });

  it('is null when no staff message names a price', () => {
    expect(standingStaffPrice([bot('Rp 1.234/pcs'), staff('halo kak'), customer('oke')])).toBeNull();
    expect(standingStaffPrice([])).toBeNull();
  });

  it('ignores prices the customer wrote', () => {
    expect(standingStaffPrice([bot('Rp 1.234/pcs'), customer('3 juta aja ya')])).toBeNull();
  });
});
