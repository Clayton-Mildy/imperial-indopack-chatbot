import type { FastifyInstance } from 'fastify';
import { apiKeyAuth } from '../../middleware/apiKey.js';
import { listContacts, setContactAiEnabled } from '../../repositories/contacts.js';
import { ContactsQuerySchema, PatchContactBodySchema } from '../../domain/schemas.js';

export async function contactRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/contacts
  app.get('/api/v1/contacts', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const query = ContactsQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    }

    const result = await listContacts(query.data);

    return reply.send({
      data: result.items,
      error: null,
      meta: { page: query.data.page, total: result.total, limit: query.data.limit },
    });
  });

  // PATCH /api/v1/contacts/:id
  app.patch<{ Params: { id: string } }>(
    '/api/v1/contacts/:id',
    { preHandler: [apiKeyAuth] },
    async (request, reply) => {
      const body = PatchContactBodySchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
      }

      const updated = await setContactAiEnabled(request.params.id, body.data.aiEnabled);
      if (!updated) {
        return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
      }

      return reply.send({ data: updated, error: null });
    }
  );
}
