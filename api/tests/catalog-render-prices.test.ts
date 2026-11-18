/**
 * catalog-render-prices.test.ts
 * How the two prices reach the AI's catalog block.
 *
 * MP (the end-user price) is RENDERED from product_variants.mp_price_idr, never computed by the
 * model: verifyReplyPrices() only accepts Rp figures that are literally in the block (or an
 * exact multiple / pack-division / pack-plus-remainder of one), so a model-computed markup
 * would be rejected as invented on every correct quote.
 *
 * The no-MP case is the load-bearing one. Rendering "tanya tim" instead of a figure is what
 * turns "escalate for that price" from a prompt request into a guarantee - see the companion
 * case in reply-checks.test.ts, which shows the invented figure being rejected. It used to be
 * a hardcoded Shind allow-list; it is now simply the absence of the column.
 *
 * Pure - no DATABASE_URL, no API key.
 */

import { describe, it, expect } from 'vitest';
import { formatProducts } from '../src/services/ragQuery.js';
import { verifyReplyPrices } from '../src/services/replyChecks.js';
import type { Product } from '../src/domain/types.js';

function productWith(
  brandName: string,
  priceIdr: number | null,
  mpPriceIdr: number | null = priceIdr === null ? null : priceIdr * 1.4,
  mpUomName = 'Set'
): Product {
  return {
    id: 'p1',
    brandId: 'b1',
    categoryId: null,
    name: 'HANDLE BESAR + BODY AOMORI SLIM TIPE MANCHESTER (7007)',
    description: null,
    fungsi: 'Sebagai pegangan pintu.',
    usp: null,
    kataKunci: null,
    kelengkapan: null,
    bahan: null,
    ketebalan: null,
    imageUrl: null,
    tier: null,
    relatedProductIds: null,
    upsellProductId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    brand: { id: 'b1', name: brandName, description: null, catalogFileUrl: null, brandType: 'own', createdAt: '2026-01-01T00:00:00.000Z' },
    category: null,
    variants: [
      {
        id: 'v1',
        productId: 'p1',
        name: 'BLACK SILVER - 25CM X 5CM',
        priceIdr,
        mpPriceIdr,
        isActive: true,
        stockStatus: 'normal',
        uomPrice: { id: 'u1', name: 'Set', description: null, createdAt: '2026-01-01T00:00:00.000Z' },
        ...(mpPriceIdr === null
          ? {}
          : { mpUom: { id: 'u2', name: mpUomName, description: null, createdAt: '2026-01-01T00:00:00.000Z' } }),
      },
    ],
  } as unknown as Product;
}

// The judge is told, in prose, what the second price on a variant line is called. When
// formatProducts was renamed RETAIL -> MP that sentence still said "RETAIL", so the judge
// stopped recognising the MP figure as a legitimate second price and rejected every correct
// end-user quote - the reply was repaired to the pricelist and then escalated. Nothing failed
// loudly; it just quietly quoted reseller prices to walk-in customers.
describe('the judge knows what the second price is called', () => {
  it('names the same label formatProducts actually renders', async () => {
    const { JUDGE_SYSTEM_PROMPT } = await import('../src/services/aiLayer.js');
    const block = formatProducts([productWith('Aomori', 46_000, 5_500, 'Pcs')]);
    const label = /\|\s*([A-Z]+):/.exec(block)?.[1];
    expect(label).toBe('MP');
    expect(JUDGE_SYSTEM_PROMPT).toContain(`"${label}: ..."`);
  });
});

describe('formatProducts - two prices per variant', () => {
  it('renders the pricelist figure then the MP figure, both with the unit', () => {
    const block = formatProducts([productWith('Aomori Slim', 125_000, 175_000)]);
    expect(block).toContain('Rp 125.000/Set | MP: Rp 175.000/Set');
  });

  it('gives MP its own unit - a lusin price and a per-piece MP sit on one line', () => {
    const block = formatProducts([productWith('Aomori', 46_000, 5_500, 'Pcs')]);
    expect(block).toContain('Rp 46.000/Set | MP: Rp 5.500/Pcs');
  });

  it('states once, and only once, which price is for whom', () => {
    const block = formatProducts([productWith('Aomori Slim', 125_000), productWith('Vintage', 210_000)]);
    expect(block.match(/harga PRICELIST/g)).toHaveLength(1);
  });

  it('renders no MP figure when the variant has none - the team sets that price', () => {
    const block = formatProducts([productWith('Shind', 45_000, null)]);
    expect(block).toContain('Rp 45.000/Set | MP: tanya tim');
    // The critical assertion: no Rp figure exists in the block other than the pricelist one,
    // so an invented end-user price cannot be waved through by verifyReplyPrices.
    expect(block.match(/Rp [\d.]+/g)).toEqual(['Rp 45.000']);
  });

  it('leaves an unpriced variant with no figure on either side', () => {
    const block = formatProducts([productWith('Blossom', null)]);
    expect(block).toContain('hubungi kami');
    expect(block).not.toContain('RETAIL:');
    expect(block.match(/Rp [\d.]+/g)).toBeNull();
  });
});

// UAT Run 2: with both prices on an out-of-stock line the model kept offering it - "gembok kuningan
// 30mm ready?" quoted BC9030's Rp 64.500 in every draft until the turn was handed to the team.
describe('formatProducts - an out-of-stock variant carries no price', () => {
  function padlock(): Product {
    const p = productWith('Blossom', 40_000, 56_000, 'Pcs');
    const [ready] = p.variants!;
    p.name = 'GEMBOK KUNINGAN TYPE BC9000';
    p.variants = [
      { ...ready!, id: 'v1', name: 'BC9025 - 25MM' },
      { ...ready!, id: 'v2', name: 'BC9030 - 30MM', priceIdr: 46_000, mpPriceIdr: 64_500, stockStatus: 'no_stock' },
    ];
    return p;
  }

  it('lists it by name with the tag and no figure', () => {
    const block = formatProducts([padlock()]);
    expect(block).toContain('  - BC9030 - 30MM [STOK HABIS SEMENTARA]\n');
    expect(block).not.toContain('46.000');
    expect(block).not.toContain('64.500');
    expect(block).toContain('BC9025 - 25MM: Rp 40.000/Set | MP: Rp 56.000/Pcs');
  });

  it('so the D-03 offer of its price fails the price check as not in the catalog', () => {
    const block = formatProducts([padlock()]);
    expect(verifyReplyPrices('• 25mm: Rp 56.000/Pcs\n• 30mm: Rp 64.500/Pcs', block, block, 'end_user').ok).toBe(false);
  });
});

// UAT Run 2 replay of C-04: "CTN: 30 Lsn" was read as the total for "3 karton" (= 30 Lsn x Rp 68.500),
// a wrong total that no price check catches - it is an honest multiple of a catalog price.
describe('formatProducts - the carton size is spelled out', () => {
  it('renders "1 karton = 30 Lsn", not "CTN: 30 Lsn"', () => {
    const p = productWith('Aomori', 68_500, 8_000, 'Pcs');
    p.variants = p.variants!.map((v) => ({ ...v, isiCtn: 30, uomCtn: { id: 'u3', name: 'Lsn', description: null, createdAt: '2026-01-01T00:00:00.000Z' } }));
    const block = formatProducts([p]);
    expect(block).toContain('| 1 karton = 30 Lsn');
    expect(block).not.toContain('CTN:');
  });
});
