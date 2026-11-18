import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { apiKeyAuth } from '../../middleware/apiKey.js';
import { startChakraSync, isChakraSyncRunning } from '../../services/chakraSync.js';
import { getChakraSyncState } from '../../repositories/appSettings.js';

const RunBodySchema = z.object({
  full: z.boolean().optional(),
  maxChats: z.number().int().positive().optional(),
});

export async function chakraSyncRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/v1/chakra-sync/run — fire and forget. A first backfill can run for hours, so
  // the request must never wait on it; poll /status for the outcome.
  app.post('/api/v1/chakra-sync/run', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const result = RunBodySchema.safeParse(request.body ?? {});
    if (!result.success) {
      return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    }
    return reply.send({ data: startChakraSync(result.data), error: null });
  });

  // GET /api/v1/chakra-sync/status
  app.get('/api/v1/chakra-sync/status', { preHandler: [apiKeyAuth] }, async (_request, reply) => {
    const state = await getChakraSyncState();
    return reply.send({ data: { ...state, running: isChakraSyncRunning() }, error: null });
  });
}
