import type { FastifyInstance } from 'fastify';
import { apiKeyAuth } from '../../middleware/apiKey.js';
import {
  listConversations,
  findConversationById,
  updateConversationStatus,
  getConversationMessages,
  upsertConversationRead,
} from '../../repositories/conversations.js';
import { getContactProfile, markFollowUpDone } from '../../repositories/contactProfiles.js';
import {
  ConversationsQuerySchema,
  PatchConversationBodySchema,
  MarkReadBodySchema,
} from '../../domain/schemas.js';

export async function conversationRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/conversations
  app.get(
    '/api/v1/conversations',
    { preHandler: [apiKeyAuth] },
    async (request, reply) => {
      const query = ConversationsQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
      }

      const rawQuery = request.query as Record<string, unknown>;
      const status = rawQuery['status'] as string | undefined;
      const upsellAccepted = rawQuery['upsell_accepted'] === 'true';

      const result = await listConversations({
        page: query.data.page,
        limit: query.data.limit,
        status: status as Parameters<typeof listConversations>[0]['status'],
        agentId: query.data.agentId,
        upsellAccepted: upsellAccepted || undefined,
      });

      return reply.send({
        data: result.items,
        error: null,
        meta: { page: query.data.page, total: result.total, limit: query.data.limit },
      });
    }
  );

  // GET /api/v1/conversations/:id
  app.get<{ Params: { id: string } }>(
    '/api/v1/conversations/:id',
    { preHandler: [apiKeyAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const conversation = await findConversationById(id);
      if (!conversation) {
        return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
      }

      const messages = await getConversationMessages(id);
      return reply.send({ data: { ...conversation, messages }, error: null });
    }
  );

  // POST /api/v1/conversations/:id/read
  app.post<{ Params: { id: string } }>(
    '/api/v1/conversations/:id/read',
    { preHandler: [apiKeyAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const bodyResult = MarkReadBodySchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
      }

      const existing = await findConversationById(id);
      if (!existing) {
        return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
      }

      await upsertConversationRead(id, bodyResult.data.agentId);
      return reply.code(204).send();
    }
  );

  // PATCH /api/v1/conversations/:id
  app.patch<{ Params: { id: string } }>(
    '/api/v1/conversations/:id',
    { preHandler: [apiKeyAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const bodyResult = PatchConversationBodySchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
      }

      const existing = await findConversationById(id);
      if (!existing) {
        return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
      }

      const { status, assignedAgent } = bodyResult.data;
      const updated = await updateConversationStatus(
        id,
        status ?? existing.status,
        undefined,
        assignedAgent
      );

      return reply.send({ data: updated, error: null });
    }
  );

  // GET /api/v1/conversations/:id/contact-profile
  app.get<{ Params: { id: string } }>(
    '/api/v1/conversations/:id/contact-profile',
    { preHandler: [apiKeyAuth] },
    async (request, reply) => {
      const conversation = await findConversationById(request.params.id);
      if (!conversation) return reply.code(404).send({ data: null, error: 'NOT_FOUND' });

      const profile = await getContactProfile(conversation.contactId);
      return reply.send({ data: profile, error: null });
    }
  );

  // PATCH /api/v1/conversations/:id/contact-profile/follow-up-done
  app.patch<{ Params: { id: string } }>(
    '/api/v1/conversations/:id/contact-profile/follow-up-done',
    { preHandler: [apiKeyAuth] },
    async (request, reply) => {
      const conversation = await findConversationById(request.params.id);
      if (!conversation) return reply.code(404).send({ data: null, error: 'NOT_FOUND' });

      await markFollowUpDone(conversation.contactId);
      return reply.send({ data: { ok: true }, error: null });
    }
  );
}
