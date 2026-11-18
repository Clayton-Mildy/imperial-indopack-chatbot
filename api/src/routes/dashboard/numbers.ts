import type { FastifyInstance } from 'fastify';
import { apiKeyAuth } from '../../middleware/apiKey.js';
import {
  listPhoneNumbers,
  findPhoneNumberById,
  createPhoneNumber,
  updatePhoneNumber,
  deletePhoneNumber,
} from '../../repositories/phoneNumbers.js';
import {
  CreatePhoneNumberBodySchema,
  PatchPhoneNumberBodySchema,
} from '../../domain/schemas.js';

export async function numberRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/numbers
  app.get('/api/v1/numbers', { preHandler: [apiKeyAuth] }, async (_request, reply) => {
    const numbers = await listPhoneNumbers();
    return reply.send({ data: numbers, error: null });
  });

  // POST /api/v1/numbers
  app.post('/api/v1/numbers', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const result = CreatePhoneNumberBodySchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    }

    try {
      const created = await createPhoneNumber(result.data);
      // prompt_sections = null means "follow default prompt" — no need to copy sections on create
      return reply.code(201).send({ data: created, error: null });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('unique') || message.includes('duplicate')) {
        return reply.code(409).send({ data: null, error: 'CONFLICT' });
      }
      throw err;
    }
  });

  // PATCH /api/v1/numbers/:id
  app.patch<{ Params: { id: string } }>(
    '/api/v1/numbers/:id',
    { preHandler: [apiKeyAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const bodyResult = PatchPhoneNumberBodySchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
      }

      let updated;
      try {
        updated = await updatePhoneNumber(id, bodyResult.data);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('unique') || msg.includes('duplicate') || (err as { code?: string }).code === '23505') {
          return reply.code(409).send({ data: null, error: 'CONFLICT' });
        }
        throw err;
      }
      if (!updated) {
        return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
      }
      return reply.send({ data: updated, error: null });
    }
  );

  // DELETE /api/v1/numbers/:id
  app.delete<{ Params: { id: string } }>(
    '/api/v1/numbers/:id',
    { preHandler: [apiKeyAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const existing = await findPhoneNumberById(id);
      if (!existing) {
        return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
      }
      await deletePhoneNumber(id);
      return reply.code(204).send();
    }
  );
}
