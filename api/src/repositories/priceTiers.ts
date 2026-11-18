import { asc, eq, inArray } from 'drizzle-orm';
import { getDb, type DbOrTx } from '../db/client.js';
import { variantPriceTiers } from '../db/schema.js';
import { toPcs, type PriceTier, type QtyUnit } from '../domain/pricing.js';

/** Tiers per variant id, each list sorted by pcs threshold ascending (5 rim before 10 rim, whatever the insert order). */
export async function listTiersByVariant(variantIds: string[]): Promise<Map<string, PriceTier[]>> {
  const out = new Map<string, PriceTier[]>();
  if (variantIds.length === 0) return out;
  const rows = await getDb()
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

/** Replace all of a variant's tiers (delete then insert), inside the caller's transaction. */
export async function replaceVariantTiers(tx: DbOrTx, variantId: string, tiers: PriceTier[]): Promise<void> {
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
