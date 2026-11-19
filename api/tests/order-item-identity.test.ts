/** One order item stays one item when the model writes its size into the product name on another turn. */
import { describe, it, expect } from 'vitest';
import { mergeOrderFacts, itemKey } from '../src/domain/orderProfile.js';

const items = (f: Record<string, unknown>) => f.items as Array<Record<string, unknown>>;

describe('item identity', () => {
  it('"box ivory 22x22x7" and "Box Ivory" + "22x22x7 cm" are one item', () => {
    const a = mergeOrderFacts({}, { items: [{ product: 'box ivory 22x22x7' }] });
    const b = mergeOrderFacts(a, { items: [{ product: 'Box Ivory', size: '22x22x7 cm', qty: 5000, qty_unit: 'pcs' }] });
    expect(items(b)).toHaveLength(1);
    expect(items(b)[0]).toMatchObject({ product: 'box ivory', size: '22x22x7', qty: 5000, qty_unit: 'pcs' });
  });
  it('size in the name with spaces and cm', () => {
    expect(itemKey({ product: 'Box Ivory 22 x 22 x 7 cm' })).toBe(itemKey({ product: 'Box Ivory', size: '22x22x7' }));
  });
  it('different sizes stay two items; gsm in the name is not a size', () => {
    const f = mergeOrderFacts({}, { items: [{ product: 'Box Ivory 310 gsm', size: '20x20x7,5' }, { product: 'Box Ivory 310 gsm', size: '22x22x7' }] });
    expect(items(f)).toHaveLength(2);
    expect(items(f)[0]!.product).toBe('Box Ivory 310 gsm');
  });
});
