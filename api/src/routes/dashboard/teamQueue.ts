import type { FastifyInstance } from 'fastify';
import { apiKeyAuth } from '../../middleware/apiKey.js';
import { TeamQueueQuerySchema } from '../../domain/schemas.js';
import { getTeamQueue } from '../../services/teamQueue.js';

export async function teamQueueRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/team-queue?assignedTo= - the Perlu Tim page (services/teamQueue.ts)
  app.get(
    '/api/v1/team-queue',
    { preHandler: [apiKeyAuth] },
    async (request, reply) => {
      const query = TeamQueueQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
      }
      const queue = await getTeamQueue({ assignedTo: query.data.assignedTo || undefined });
      return reply.send({ data: queue, error: null });
    }
  );
}
