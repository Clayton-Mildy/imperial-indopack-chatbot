import type { FastifyInstance } from 'fastify';
import { getFullCatalogBlock, invalidateCatalogCache } from '../../services/ragQuery.js';

/**
 * Any successful write (POST/PUT/PATCH/DELETE) in the calling plugin's routes, present or future, can
 * change what getFullCatalogBlock() memoizes - one hook invalidates it for all of them instead of a call
 * at the end of every handler. Registered by catalog.ts and catalogProducts.ts, each in its own scope.
 */
export function invalidateCatalogOnWrite(app: FastifyInstance): void {
  app.addHook('onResponse', async (request, reply) => {
    if (request.method !== 'GET' && reply.statusCode < 400) {
      invalidateCatalogCache();
      // Rebuild in the background so the next customer message never blocks on it;
      // the in-flight dedup in getFullCatalogBlock shares this build with any real request.
      getFullCatalogBlock().catch(() => { });
    }
  });
}
