/**
 * gramasi-choice.test.ts
 *
 * Whether an order item still needs a gramasi before the PO form (spec 5.6): the product the
 * nearest-catalog match picks, the item's size exactly as the catalog has it, and the gramasi that
 * size is sold in. Pure - the catalog is passed in.
 */

import { describe, it, expect } from 'vitest';
import { gramasiChoice } from '../src/services/gramasiChoice.js';
import { gramasiBeforePoLine } from '../src/domain/constants.js';
import { MESSAGE_SOURCE } from '../src/domain/messageSources.js';
import type { Product } from '../src/domain/types.js';
import { BOX_GRAMASI, IVORY_BOX } from './price-fixtures.js';

// 'Box Makan Ivory (CONTOH)': 20x20x7 in 270 and 300 gsm; 25x25x7 in 300 gsm only; 30x30x7 in 300 gsm,
// its 270 gsm row switched off.
const BOX: Product = {
  ...BOX_GRAMASI,
  variants: [
    ...BOX_GRAMASI.variants!,
    { ...BOX_GRAMASI.variants![0]!, id: 'v-ii2-25-300', name: '25x25x7', gsm: '300 gsm' },
    { ...BOX_GRAMASI.variants![0]!, id: 'v-ii2-30-300', name: '30x30x7', gsm: '300 gsm' },
    { ...BOX_GRAMASI.variants![0]!, id: 'v-ii2-30-270', name: '30x30x7', gsm: '270 gsm', isActive: false },
  ],
};
const CATALOG: Product[] = [BOX, IVORY_BOX];
const box = (size: string, gsm?: string) => ({ product: 'Box Makan Ivory', size, ...(gsm !== undefined && { gsm }), qty: 10, qty_unit: 'rim' as const });

describe('gramasiChoice', () => {
  it('chosen: the item names a gramasi the size is sold in', () =>
    expect(gramasiChoice(box('20x20x7', '300 gsm'), CATALOG)).toEqual({ kind: 'chosen', gsm: '300 gsm' }));

  it.each(['300', '300gsm', '300 GSM', ' 300 gsm '])('chosen: %j is the same gramasi as 300 gsm', (gsm) =>
    expect(gramasiChoice(box('20x20x7', gsm), CATALOG)).toEqual({ kind: 'chosen', gsm: '300 gsm' }));

  // An item written before gramasi options carries it in the product name, as the old catalog did.
  // (Only BOX here: "gsm" in the item's name is also a word of IVORY_BOX's name, and that tie is
  // nearestCatalogItems' to settle.)
  it('chosen: a gramasi the product name of an older item says', () =>
    expect(gramasiChoice({ product: 'Box Makan Ivory 300 gsm', size: '20x20x7' }, [BOX])).toEqual({ kind: 'chosen', gsm: '300 gsm' }));

  it('the name counts only when the item has no gsm, and only a whole gramasi ("30 gsm" is not 300)', () => {
    expect(gramasiChoice({ product: 'Box Makan Ivory 300 gsm', size: '20x20x7', gsm: 'tebal' }, [BOX])).toEqual({ kind: 'ask', options: ['270 gsm', '300 gsm'] });
    expect(gramasiChoice({ product: 'Box Makan Ivory 30 gsm', size: '20x20x7' }, [BOX])).toEqual({ kind: 'ask', options: ['270 gsm', '300 gsm'] });
  });

  it('ask: no gramasi on an item whose size two gramasi offer, ascending', () =>
    expect(gramasiChoice(box('20x20x7'), CATALOG)).toEqual({ kind: 'ask', options: ['270 gsm', '300 gsm'] }));

  // Review Focus 2: "yang tebal" or "yang paling murah" recorded as gsm is not a choice.
  it.each(['tebal', 'yang paling murah'])('ask: a word recorded as gsm (%j) is no gramasi', (gsm) =>
    expect(gramasiChoice(box('20x20x7', gsm), CATALOG)).toEqual({ kind: 'ask', options: ['270 gsm', '300 gsm'] }));

  it('ask: a gramasi the size is not sold in is no choice either', () =>
    expect(gramasiChoice(box('20x20x7', '350 gsm'), CATALOG)).toEqual({ kind: 'ask', options: ['270 gsm', '300 gsm'] }));

  it('the size written another way is the same size', () =>
    expect(gramasiChoice(box('20 x 20 x 7 cm'), CATALOG)).toEqual({ kind: 'ask', options: ['270 gsm', '300 gsm'] }));

  it('only: one gramasi offers the size', () =>
    expect(gramasiChoice(box('25x25x7'), CATALOG)).toEqual({ kind: 'only', gsm: '300 gsm' }));

  it('only: a switched-off row is not on offer', () =>
    expect(gramasiChoice(box('30x30x7'), CATALOG)).toEqual({ kind: 'only', gsm: '300 gsm' }));

  it('only: also when the item already names it', () =>
    expect(gramasiChoice(box('25x25x7', '300'), CATALOG)).toEqual({ kind: 'only', gsm: '300 gsm' }));

  it('none: an inexact size (a custom size the team prices)', () =>
    expect(gramasiChoice(box('22x22x7'), CATALOG)).toEqual({ kind: 'none' }));

  it('none: a product without gramasi', () =>
    expect(gramasiChoice({ product: 'Box Ivory cetak full color', size: '20x20x7,5' }, [IVORY_BOX])).toEqual({ kind: 'none' }));

  it('none: no product matches, or the item has no size', () => {
    expect(gramasiChoice({ product: 'Paper Bag', size: '20x20x7' }, CATALOG)).toEqual({ kind: 'none' });
    expect(gramasiChoice({ product: 'Box Makan Ivory' }, CATALOG)).toEqual({ kind: 'none' });
    expect(gramasiChoice(box('20x20x7'), [])).toEqual({ kind: 'none' });
  });
});

describe('the gramasi question', () => {
  it('is the fixed line, naming the size\'s gramasi', () => {
    expect(gramasiBeforePoLine(['270 gsm', '300 gsm'])).toBe('Sebelum form PO-nya saya kirim, mau yang gramasi berapa kak: 270 atau 300 gsm?');
    expect(gramasiBeforePoLine(['270 gsm', '300 gsm', '350 gsm'])).toBe('Sebelum form PO-nya saya kirim, mau yang gramasi berapa kak: 270, 300 atau 350 gsm?');
  });

  it('has its own message source', () => expect(MESSAGE_SOURCE.gramasiQuestion).toBe('gramasi_question'));
});
