import { asc, eq, inArray } from 'drizzle-orm';
import { getDb, type DbOrTx } from '../db/client.js';
import { variantPriceTiers } from '../db/schema.js';
import { toPcs, type PriceTier, type QtyUnit } from '../domain/pricing.js';

/**
 * Tiers per variant id, each list sorted by pcs threshold ascending (5 rim before 10 rim, whatever the insert order).
 * `db` lets a caller read inside its own transaction.
 */
export async function listTiersByVariant(variantIds: string[], db: DbOrTx = getDb()): Promise<Map<string, PriceTier[]>> {
  const out = new Map<string, PriceTier[]>();
  if (variantIds.length === 0) return out;
  const rows = await db
    .select()
    .from(variantPriceTiers)
    .where(inArray(variantPriceTiers.variantId, variantIds))
    .orderBy(asc(variantPriceTiers.createdAt), asc(variantPriceTiers.minQty));
  for (const r of rows) {
    const tier: PriceTier = {
      minQty: r.minQty,
      qtyUnit: r.qtyUnit as QtyUnit,
      priceIdr: Number(r.priceIdr),
      priceUnit: r.priceUnit as PriceTier['priceUnit'],
      includesDelivery: r.includesDelivery,
      ...(r.note ? { note: r.note } : {}),
    };
    const arr = out.get(r.variantId) ?? [];
    arr.push(tier);
    out.set(r.variantId, arr);
  }
  for (const arr of out.values()) arr.sort((a, b) => toPcs(a.minQty, a.qtyUnit) - toPcs(b.minQty, b.qtyUnit));
  return out;
}

/**
 * Replace all of a variant's tiers (delete then insert), inside the caller's transaction.
 * Prices are whole rupiah: a fractional one is refused before anything is written, so it can never
 * reach the catalog block, hitung_harga or the strict price check, whichever caller sent it. And one
 * threshold has one price: "5 rim" next to "2500 pcs" is refused too (final review M10).
 */
export async function replaceVariantTiers(tx: DbOrTx, variantId: string, tiers: PriceTier[]): Promise<void> {
  const bad = tiers.find((t) => !Number.isSafeInteger(t.priceIdr));
  if (bad) {
    throw new Error(`Tier price must be whole rupiah, got ${bad.priceIdr} (variant ${variantId}, from ${bad.minQty} ${bad.qtyUnit})`);
  }
  const thresholds = tiers.map((t) => toPcs(t.minQty, t.qtyUnit));
  const twin = tiers.find((_, i) => thresholds.indexOf(thresholds[i]!) !== i);
  if (twin) {
    throw new Error(`Two tiers at the same threshold (${toPcs(twin.minQty, twin.qtyUnit)} pcs) for variant ${variantId}: one price per quantity`);
  }
  await tx.delete(variantPriceTiers).where(eq(variantPriceTiers.variantId, variantId));
  if (tiers.length === 0) return;
  await tx.insert(variantPriceTiers).values(
    tiers.map((t) => ({
      variantId,
      minQty: t.minQty,
      qtyUnit: t.qtyUnit,
      priceIdr: String(t.priceIdr),
      priceUnit: t.priceUnit,
      includesDelivery: t.includesDelivery,
      note: t.note ?? null,
    }))
  );
}
