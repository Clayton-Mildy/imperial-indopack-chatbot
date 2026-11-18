import type { FastifyInstance } from 'fastify';
import { apiKeyAuth } from '../../middleware/apiKey.js';
import { CreateActivityLogBodySchema, ActivityLogQuerySchema } from '../../domain/schemas.js';
import { insertLog, listLogs } from '../../repositories/activityLogs.js';

export async function activityLogRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/v1/activity-logs — write a log entry
  app.post(
    '/api/v1/activity-logs',
    { preHandler: [apiKeyAuth] },
    async (request, reply) => {
      const result = CreateActivityLogBodySchema.safeParse(request.body);
      if (!result.success) {
        return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
      }

      const { message, performedBy, entityType, entityId } = result.data;

      await insertLog({ message, performedBy, entityType, entityId });

      return reply.code(201).send({ data: { id: null }, error: null });
    }
  );

  // GET /api/v1/activity-logs — list log entries with optional filters
  app.get(
    '/api/v1/activity-logs',
    { preHandler: [apiKeyAuth] },
    async (request, reply) => {
      const query = ActivityLogQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
      }

      const { page, limit, search, startDate, endDate } = query.data;

      const result = await listLogs({ page, limit, search, startDate, endDate });

      return reply.send({
        data: result.items,
        error: null,
        meta: { page, total: result.total, limit },
      });
    }
  );
}
