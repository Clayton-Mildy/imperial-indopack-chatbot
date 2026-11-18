/**
 * ragquery-catalog-cache.test.ts
 * getFullCatalogBlock()/invalidateCatalogCache(): the memo, the 60-min max age, and
 * concurrent-call coalescing. listProducts is mocked — this is pure cache logic, no DB.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Product, ProductVariant } from '../src/domain/types.js';

const mockListProducts = vi.fn();
vi.mock('../src/repositories/products.js', () => ({
  listProducts: mockListProducts,
  hybridSearchProducts: vi.fn(),
}));

const { getFullCatalogBlock, getCatalogProducts, invalidateCatalogCache } = await import('../src/services/ragQuery.js');

function makeVariant(name: string, isActive: boolean): ProductVariant {
  return {
    id: name, productId: 'p', name, sku: null, priceIdr: 1000,
    isiCtn: null, isiBox: null, uomPriceId: null, uomCtnId: null, uomBoxId: null,
    minOrderQty: null, minOrderUomId: null, imageUrl: null, stockStatus: 'normal',
    isActive, description: null, sourceUrl: null, scrapedAt: null, sourceHash: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

function makeProduct(name: string, hasActiveVariant: boolean): Product {
  return {
    id: name,
    brandId: 'brand-1',
    categoryId: null,
    name,
    description: null,
    fungsi: null,
    usp: null,
    kataKunci: null,
    kelengkapan: null,
    bahan: null,
    ketebalan: null,
    imageUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    variants: [makeVariant(`${name} varian`, hasActiveVariant)],
  };
}

beforeEach(() => {
  mockListProducts.mockReset();
  invalidateCatalogCache();
});

describe('getFullCatalogBlock', () => {
  it('drops products with no active variant, and memoizes so listProducts runs once', async () => {
    mockListProducts.mockResolvedValue({
      products: [makeProduct('Active One', true), makeProduct('Inactive One', false)],
      total: 2,
    });

    const first = await getFullCatalogBlock();
    const second = await getFullCatalogBlock();

    expect(first).toContain('Produk: Active One');
    expect(first).not.toContain('Produk: Inactive One');
    expect(second).toBe(first);
    expect(mockListProducts).toHaveBeenCalledTimes(1);
    expect(mockListProducts).toHaveBeenCalledWith({ limit: 0, activeOnly: true });
  });

  it('coalesces concurrent calls into a single listProducts fetch', async () => {
    mockListProducts.mockResolvedValue({ products: [makeProduct('Solo', true)], total: 1 });

    const [a, b] = await Promise.all([getFullCatalogBlock(), getFullCatalogBlock()]);

    expect(a).toBe(b);
    expect(mockListProducts).toHaveBeenCalledTimes(1);
  });

  it('invalidateCatalogCache forces a rebuild on the next call', async () => {
    mockListProducts.mockResolvedValue({ products: [makeProduct('First', true)], total: 1 });
    await getFullCatalogBlock();

    mockListProducts.mockResolvedValue({ products: [makeProduct('Second', true)], total: 1 });
    invalidateCatalogCache();
    const rebuilt = await getFullCatalogBlock();

    expect(rebuilt).toContain('Produk: Second');
    expect(mockListProducts).toHaveBeenCalledTimes(2);
  });
});

describe('getFullCatalogBlock — failure and race hardening (adversarial-review findings)', () => {
  it('retries after a transient DB error instead of memoizing the rejection forever', async () => {
    // The wedge: one failed build at boot must cost one message, not every message
    // until a service restart.
    mockListProducts.mockRejectedValueOnce(new Error('db starting up'));
    await expect(getFullCatalogBlock()).rejects.toThrow('db starting up');

    mockListProducts.mockResolvedValue({ products: [makeProduct('Recovered', true)], total: 1 });
    const block = await getFullCatalogBlock();

    expect(block).toContain('Produk: Recovered');
    expect(mockListProducts).toHaveBeenCalledTimes(2);
  });

  it('a build racing an invalidation does not commit its stale result', async () => {
    let release!: (v: { products: Product[]; total: number }) => void;
    mockListProducts.mockReturnValueOnce(new Promise((res) => { release = res; }));

    const inFlight = getFullCatalogBlock(); // cold build, hanging on the DB
    invalidateCatalogCache();               // dashboard edit lands mid-build
    release({ products: [makeProduct('Stale', true)], total: 1 });
    await inFlight;                         // stale build resolves — must NOT be cached

    mockListProducts.mockResolvedValue({ products: [makeProduct('Fresh', true)], total: 1 });
    const next = await getFullCatalogBlock();

    expect(next).toContain('Produk: Fresh');
    expect(next).not.toContain('Stale');
  });
});

// hitung_harga prices from getCatalogProducts(): it must be the list the block was rendered from,
// or the tool could quote tiers the model was never shown.
describe('getCatalogProducts — the price tool\'s catalog', () => {
  it('is the block\'s own product list: active products only, one fetch for both', async () => {
    mockListProducts.mockResolvedValue({
      products: [makeProduct('Active One', true), makeProduct('Inactive One', false)],
      total: 2,
    });

    const block = await getFullCatalogBlock();
    const products = await getCatalogProducts();

    expect(block).toContain('Produk: Active One');
    expect(products.map((p) => p.name)).toEqual(['Active One']);
    expect(mockListProducts).toHaveBeenCalledTimes(1);
  });

  it('invalidateCatalogCache clears it together with the block', async () => {
    mockListProducts.mockResolvedValue({ products: [makeProduct('First', true)], total: 1 });
    await getCatalogProducts();

    mockListProducts.mockResolvedValue({ products: [makeProduct('Second', true)], total: 1 });
    invalidateCatalogCache();

    expect((await getCatalogProducts()).map((p) => p.name)).toEqual(['Second']);
    expect(await getFullCatalogBlock()).toContain('Produk: Second');
    expect(mockListProducts).toHaveBeenCalledTimes(2);
  });
});
