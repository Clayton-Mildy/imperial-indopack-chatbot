/**
 * order-details.test.ts
 *
 * The six order details the Perlu Tim queue and the conversation panel show (Nama, Usaha, Model,
 * Ukuran, Jumlah, Desain), read from the facts the bot collected in contact_profiles.profile. Pure.
 */

import { describe, it, expect } from 'vitest';
import { ORDER_DETAIL_KEYS, orderDetailRows, formatItemQty, orderItemsSummary } from '../src/domain/orderDetails.js';
import type { OrderItem } from '../src/domain/orderProfile.js';
import type { QtyUnit } from '../src/domain/pricing.js';

const ANDI = { name: 'Andi', business_name: 'Katering Contoh Sehat', items: [{ product: 'Box Ivory', print: 'full color', size: '22x22x7', qty: 5000, qty_unit: 'pcs', has_design: true }] };
const row = (facts: Record<string, unknown>, key: string) => orderDetailRows(facts).find((r) => r.key === key);

describe('orderDetailRows', () => {
  it('six rows in order, all filled', () => {
    const rows = orderDetailRows(ANDI);
    expect(rows.map((r) => r.key)).toEqual([...ORDER_DETAIL_KEYS]);
    expect(rows.every((r) => r.filled)).toBe(true);
    expect(rows.find((r) => r.key === 'qty')?.value).toBe('5.000 pcs (10 rim)');
    expect(rows.find((r) => r.key === 'design')?.value).toBe('Ada');
  });

  it('names the model with its print, and the size as the customer gave it', () => {
    expect(row(ANDI, 'name')?.value).toBe('Andi');
    expect(row(ANDI, 'business_name')?.value).toBe('Katering Contoh Sehat');
    expect(row(ANDI, 'model')?.value).toBe('Box Ivory, cetak full color');
    expect(row(ANDI, 'size')?.value).toBe('22x22x7');
    expect(row({ items: [{ product: 'Kertas Supreme', gsm: '64' }] }, 'model')?.value).toBe('Kertas Supreme 64 gsm');
    expect(row({ items: [{ product: 'Kertas Supreme 64 gsm', gsm: '64' }] }, 'model')?.value).toBe('Kertas Supreme 64 gsm');
  });

  it('design unknown is not filled; false is "Belum ada"', () => {
    expect(row({ ...ANDI, items: [{ product: 'Box Ivory' }] }, 'design')).toEqual({ key: 'design', filled: false, value: null });
    expect(row({ ...ANDI, items: [{ product: 'Box Ivory', has_design: false }] }, 'design')).toEqual({ key: 'design', filled: true, value: 'Belum ada' });
  });

  // mergeOrderFacts keeps a design fact said before any product or size as the order's own has_design.
  it('fills design from the order-level has_design', () => {
    expect(row({ name: 'Rina', has_design: true }, 'design')).toEqual({ key: 'design', filled: true, value: 'Ada' });
    expect(row({ has_design: false }, 'design')?.value).toBe('Belum ada');
    expect(row({ has_design: true, items: [{ product: 'Box Ivory', has_design: false }] }, 'design')?.value).toBe('Ada');
    expect(row({ has_design: false, items: [{ product: 'Box Ivory', has_design: true }] }, 'design')?.value).toBe('Ada');
  });

  it('nothing known: six rows, none filled', () => {
    expect(orderDetailRows({})).toEqual(ORDER_DETAIL_KEYS.map((key) => ({ key, filled: false, value: null })));
  });

  it('joins several items with "; "', () => {
    const facts = {
      items: [
        { product: 'Box Ivory', print: 'full color', size: '22x22x7', qty: 5000, qty_unit: 'pcs' },
        { product: 'Kertas Supreme 64 gsm', size: '30x30', qty: 12, qty_unit: 'rim' },
      ],
    };
    expect(row(facts, 'model')?.value).toBe('Box Ivory, cetak full color; Kertas Supreme 64 gsm');
    expect(row(facts, 'size')?.value).toBe('22x22x7; 30x30');
    expect(row(facts, 'qty')?.value).toBe('5.000 pcs (10 rim); 12 rim (6.000 pcs)');
  });

  // contact_profiles.profile is jsonb the model wrote; old rows predate validation.
  it('ignores malformed stored values', () => {
    const facts = { name: '  ', business_name: 42, items: [{ product: '', size: 7, qty: '2.500', qty_unit: 'pcs' }, 'x', null] };
    expect(row(facts, 'name')?.filled).toBe(false);
    expect(row(facts, 'business_name')?.filled).toBe(false);
    expect(row(facts, 'model')?.filled).toBe(false);
    expect(row(facts, 'size')?.value).toBe('7');
    expect(row(facts, 'qty')?.value).toBe('2.500 pcs (5 rim)');
    expect(row({ items: 'nope' }, 'qty')?.filled).toBe(false);
  });

  it('a quantity without a unit is the number alone', () => {
    expect(row({ items: [{ product: 'Box Ivory', qty: 300 }] }, 'qty')?.value).toBe('300');
  });
});

describe('formatItemQty', () => {
  it.each([[5000, 'pcs', '5.000 pcs (10 rim)'], [12, 'rim', '12 rim (6.000 pcs)'], [2700, 'pcs', '2.700 pcs']] as [number, QtyUnit, string][])(
    'formatItemQty(%i, %s)', (q, u, s) => expect(formatItemQty(q, u)).toBe(s));

  it('writes a fraction with a comma', () => expect(formatItemQty(2.5, 'rim')).toBe('2,5 rim (1.250 pcs)'));
});

describe('orderItemsSummary', () => {
  it('one full item', () =>
    expect(orderItemsSummary(ANDI.items as OrderItem[])).toBe('Box Ivory, cetak full color · 22x22x7 · 5.000 pcs (10 rim) · desain ada'));

  it('drops unknown parts and says when there is no design', () => {
    expect(orderItemsSummary([{ product: 'Kertas Supreme 64 gsm', qty: 10, qty_unit: 'rim' }])).toBe('Kertas Supreme 64 gsm · 10 rim (5.000 pcs)');
    expect(orderItemsSummary([{ size: '20x20', has_design: false }])).toBe('20x20 · belum ada desain');
  });

  it('joins items with " + " and skips an empty one', () =>
    expect(orderItemsSummary([{ product: 'Box Ivory', qty: 2700, qty_unit: 'pcs' }, {}, { product: 'Kertas Supreme 64 gsm', size: '30x30' }]))
      .toBe('Box Ivory · 2.700 pcs + Kertas Supreme 64 gsm · 30x30'));

  it('no items is empty', () => expect(orderItemsSummary([])).toBe(''));
});
