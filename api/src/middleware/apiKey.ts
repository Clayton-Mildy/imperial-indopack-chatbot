import type { FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'crypto';
import { getDb } from '../db/client.js';
import { apiKeys } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export async function apiKeyAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    reply.code(401).send({ data: null, error: 'UNAUTHORIZED' });
    return;
  }

  const rawKey = authHeader.slice(7);
  if (!rawKey) {
    reply.code(401).send({ data: null, error: 'UNAUTHORIZED' });
    return;
  }

  const keyHash = createHash('sha256').update(rawKey).digest('hex');

  const db = getDb();
  const [key] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);

  if (!key || key.revokedAt !== null) {
    reply.code(401).send({ data: null, error: 'UNAUTHORIZED' });
    return;
  }

  // Update last_used_at asynchronously — don't block the request
  void db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, key.id))
    .execute();
}
