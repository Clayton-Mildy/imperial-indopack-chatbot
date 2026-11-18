import type { FastifyInstance } from 'fastify';
import { apiKeyAuth } from '../../middleware/apiKey.js';
import { listConversations } from '../../repositories/conversations.js';

export async function escalationRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/escalations
  app.get(
    '/api/v1/escalations',
    { preHandler: [apiKeyAuth] },
    async (_request, reply) => {
      const result = await listConversations({ page: 1, limit: 100, status: 'escalated' });
      return reply.send({ data: result.items, error: null });
    }
  );
}
