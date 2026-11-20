import type { FastifyInstance } from 'fastify';
import { apiKeyAuth } from '../../middleware/apiKey.js';
import {
  listPhoneNumbers,
  findPhoneNumberById,
  createPhoneNumber,
  updatePhoneNumber,
  deletePhoneNumber,
  countConversationsForPhoneNumber,
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
      // Its conversations reference it, so the database refuses the delete. Say so, with the count, rather
      // than let that refusal surface as a bare 500 (live 2026-11-20). Chats are never deleted from here.
      const hasChats = (conversations: number) =>
        reply.code(409).send({ data: null, error: 'NUMBER_HAS_CONVERSATIONS', details: { conversations } });
      const chats = await countConversationsForPhoneNumber(id);
      if (chats > 0) return hasChats(chats);
      try {
        await deletePhoneNumber(id);
      } catch (err) {
        // A chat started on this number between the count and the delete.
        if ((err as { code?: string; cause?: { code?: string } }).code === '23503'
          || (err as { cause?: { code?: string } }).cause?.code === '23503') {
          return hasChats(await countConversationsForPhoneNumber(id));
        }
        throw err;
      }
      return reply.code(204).send();
    }
  );
}
