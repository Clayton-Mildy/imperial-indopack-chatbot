import { desc, eq, sql } from 'drizzle-orm';
import { getDb, type DbOrTx } from '../db/client.js';
import { catalogAudit, staffProfiles } from '../db/schema.js';
import type { Actor, CatalogChange } from '../services/catalogEditor.js';

export type CatalogChangeType = 'created' | 'updated' | 'imported' | 'activated' | 'deactivated' | 'deleted';

export interface CatalogHistoryEntry {
  id: string;
  changeType: CatalogChangeType;
  changes: CatalogChange[];
  actorName: string;
  changedAt: string;
}

/**
 * One history row, inside the caller's transaction. A staff id that no longer exists is stored as
 * NULL rather than failing the save: the name is what the history shows.
 */
export async function recordCatalogChange(
  tx: DbOrTx,
  productId: string,
  type: CatalogChangeType,
  changes: CatalogChange[],
  actor: Actor
): Promise<void> {
  await tx.insert(catalogAudit).values({
    itemId: productId,
    changedBy: actor.staffId ? sql`(SELECT ${staffProfiles.id} FROM ${staffProfiles} WHERE ${staffProfiles.id} = ${actor.staffId})` : null,
    changeType: type,
    diff: changes,
    actorName: actor.name,
  });
}

/** A product's history, newest first. Kept after the product is deleted (item_id has no foreign key). */
export async function listCatalogHistory(productId: string, limit = 20): Promise<CatalogHistoryEntry[]> {
  const rows = await getDb()
    .select({ row: catalogAudit, staffName: staffProfiles.name })
    .from(catalogAudit)
    .leftJoin(staffProfiles, eq(staffProfiles.id, catalogAudit.changedBy))
    .where(eq(catalogAudit.itemId, productId))
    .orderBy(desc(catalogAudit.changedAt))
    .limit(limit);
  return rows.map(({ row, staffName }) => ({
    id: row.id,
    changeType: row.changeType as CatalogChangeType,
    changes: Array.isArray(row.diff) ? (row.diff as CatalogChange[]) : [],
    actorName: row.actorName ?? staffName ?? 'Sistem',
    changedAt: row.changedAt.toISOString(),
  }));
}
