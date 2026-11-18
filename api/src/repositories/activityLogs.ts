import { desc, ilike, and, gte, lt, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { activityLogs } from '../db/schema.js';
import type { ActivityLog } from '../domain/types.js';

export async function insertLog(data: {
  message: string;
  performedBy: string;
  entityType?: string;
  entityId?: string;
}): Promise<void> {
  const db = getDb();
  await db.insert(activityLogs).values({
    message: data.message,
    performedBy: data.performedBy,
    entityType: data.entityType ?? null,
    entityId: data.entityId ?? null,
  });
}

export async function listLogs(params: {
  search?: string;
  startDate?: string;
  endDate?: string;
  page: number;
  limit: number;
}): Promise<{ items: ActivityLog[]; total: number }> {
  const db = getDb();
  const offset = (params.page - 1) * params.limit;

  const conditions = [];

  if (params.search) {
    conditions.push(ilike(activityLogs.message, `%${params.search}%`));
  }

  if (params.startDate) {
    conditions.push(gte(activityLogs.createdAt, new Date(params.startDate)));
  }

  if (params.endDate) {
    // end of the endDate day — add one day
    const end = new Date(params.endDate);
    end.setUTCDate(end.getUTCDate() + 1);
    conditions.push(lt(activityLogs.createdAt, end));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, countResult] = await Promise.all([
    db
      .select()
      .from(activityLogs)
      .where(whereClause)
      .orderBy(desc(activityLogs.createdAt))
      .limit(params.limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(activityLogs)
      .where(whereClause),
  ]);

  return {
    items: rows.map(mapLog),
    total: countResult[0]?.count ?? 0,
  };
}

function mapLog(row: typeof activityLogs.$inferSelect): ActivityLog {
  return {
    id: row.id,
    message: row.message,
    performedBy: row.performedBy,
    entityType: row.entityType,
    entityId: row.entityId,
    createdAt: row.createdAt,
  };
}
