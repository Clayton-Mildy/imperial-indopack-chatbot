/**
 * price-tiers-repo.test.ts
 * Tier prices are whole rupiah where they are written, so a fractional figure can never reach the
 * catalog block or the strict price check, whoever writes it (the import already refuses decimals).
 *
 * Pure - a fake transaction records what would be written; no DATABASE_URL.
 */

import { describe, it, expect, vi } from 'vitest';
import { replaceVariantTiers } from '../src/repositories/priceTiers.js';
import type { PriceTier } from '../src/domain/pricing.js';

function fakeTx() {
  const where = vi.fn(async () => {});
  const values = vi.fn(async () => {});
  const del = vi.fn(() => ({ where }));
  const insert = vi.fn(() => ({ values }));
  return { tx: { delete: del, insert } as never, del, insert, values };
}

const tier = (priceIdr: number): PriceTier => ({ minQty: 5, qtyUnit: 'rim', priceIdr, priceUnit: 'pcs', includesDelivery: true });

describe('replaceVariantTiers - whole rupiah only', () => {
  it.each([1999.5, 0.1, Number.NaN, Number.POSITIVE_INFINITY])('rejects a price of %s before writing anything', async (price) => {
    const { tx, del, insert } = fakeTx();
    await expect(replaceVariantTiers(tx, 'v1', [tier(2000), tier(price)])).rejects.toThrow(/whole rupiah/);
    // Not even the delete: the variant keeps the tiers it had.
    expect(del).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('writes whole-rupiah tiers as they are', async () => {
    const { tx, del, values } = fakeTx();
    await replaceVariantTiers(tx, 'v1', [tier(2000), { ...tier(1800), minQty: 10 }]);
    expect(del).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({ variantId: 'v1', minQty: 5, priceIdr: '2000' }),
      expect.objectContaining({ variantId: 'v1', minQty: 10, priceIdr: '1800' }),
    ]);
  });
});
