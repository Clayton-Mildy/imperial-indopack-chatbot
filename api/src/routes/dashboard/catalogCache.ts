import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getFullCatalogBlock, invalidateCatalogCache } from '../../services/ragQuery.js';

/** `?dryRun=1` (or `true`): a preview that writes nothing, so it must not throw the cached catalog away. */
function isDryRun(request: FastifyRequest): boolean {
  const v = (request.query as { dryRun?: unknown } | null | undefined)?.dryRun;
  return v === '1' || v === 'true';
}

/**
 * Any successful write (POST/PUT/PATCH/DELETE) in the calling plugin's routes, present or future, can
 * change what getFullCatalogBlock() memoizes - one hook invalidates it for all of them instead of a call
 * at the end of every handler. Registered by catalog.ts and catalogProducts.ts, each in its own scope.
 */
export function invalidateCatalogOnWrite(app: FastifyInstance): void {
  app.addHook('onResponse', async (request, reply) => {
    if (request.method !== 'GET' && reply.statusCode < 400 && !isDryRun(request)) {
      invalidateCatalogCache();
      // Rebuild in the background so the next customer message never blocks on it;
      // the in-flight dedup in getFullCatalogBlock shares this build with any real request.
      getFullCatalogBlock().catch(() => { });
    }
  });
}
