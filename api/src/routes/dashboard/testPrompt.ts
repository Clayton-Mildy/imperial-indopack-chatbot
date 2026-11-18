import type { FastifyInstance } from 'fastify';
import { apiKeyAuth } from '../../middleware/apiKey.js';
import {
  TestPromptBodySchema,
  TestPromptChatBodySchema,
  TestPromptStartBodySchema,
} from '../../domain/schemas.js';
import { buildContextForTest, callAIWithHistory } from '../../services/aiLayer.js';
import { detectHumanRequest } from '../../services/escalationHandler.js';
import { findPhoneNumberById } from '../../repositories/phoneNumbers.js';
import { upsertContact } from '../../repositories/contacts.js';
import {
  findConversationByContactAndPhone,
  findConversationById,
  upsertConversation,
  insertMessage,
  getLastNMessages,
  updateConversationStatus,
  resetConversationToActive,
  listTestConversations,
} from '../../repositories/conversations.js';
import { MAX_CONTEXT_MESSAGES } from '../../domain/constants.js';

const TEST_WA_ID = 'test-kc-demo';
const TEST_DISPLAY_NAME = 'Demo (Test Prompt)';

export async function testPromptRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/v1/test-prompt (legacy single-shot endpoint — kept for backwards compat)
  app.post('/api/v1/test-prompt', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const result = TestPromptBodySchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    }

    const { phoneNumberId, message } = result.data;

    const phoneNumber = await findPhoneNumberById(phoneNumberId);
    const promptSections = phoneNumber?.promptSections ?? null;

    let context, aiResponse;
    try {
      [context, aiResponse] = await Promise.all([
        buildContextForTest(phoneNumberId, message, promptSections),
        callAIWithHistory([], message, promptSections),
      ]);
    } catch (err) {
      request.log.error({ err }, 'Test-prompt AI call failed');
      return reply.code(502).send({ data: null, error: 'AI_UNAVAILABLE' });
    }

    return reply.send({
      data: { ...context, aiResponse },
      error: null,
    });
  });

  // POST /api/v1/test-prompt/start — create a real DB conversation
  app.post('/api/v1/test-prompt/start', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const result = TestPromptStartBodySchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    }

    const { phoneNumberId } = result.data;

    // 1. Look up the phone number
    const phoneNumber = await findPhoneNumberById(phoneNumberId);
    if (!phoneNumber) {
      return reply.code(404).send({ data: null, error: 'PHONE_NUMBER_NOT_FOUND' });
    }

    // 2. Find or create test contact
    const contact = await upsertContact(TEST_WA_ID, TEST_DISPLAY_NAME);

    // 3. Find or create conversation; if exists, reset to active
    const existing = await findConversationByContactAndPhone(contact.id, phoneNumberId);
    let conversation;
    if (existing) {
      conversation = await resetConversationToActive(existing.id);
      if (!conversation) throw new Error('Failed to reset conversation');
    } else {
      conversation = await upsertConversation(contact.id, phoneNumberId);
    }

    return reply.send({ data: { conversationId: conversation.id }, error: null });
  });

  // POST /api/v1/test-prompt/chat
  app.post('/api/v1/test-prompt/chat', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const result = TestPromptChatBodySchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    }

    const { phoneNumberId, conversationId, messages, newMessage, imageData } = result.data;

    // ── DB-backed path ──────────────────────────────────────────────────────
    if (conversationId) {
      // 1. Load the conversation
      const conversation = await findConversationById(conversationId);
      if (!conversation) {
        return reply.code(404).send({ data: null, error: 'CONVERSATION_NOT_FOUND' });
      }

      // 2. Check human takeover — still save the customer message, just skip AI
      const humanStatuses = ['needs_human', 'resolved'];
      if (humanStatuses.includes(conversation.status) || conversation.assignedAgent !== null) {
        await insertMessage({ conversationId, role: 'user', body: newMessage, waMessageId: undefined, senderName: null });
        return reply.send({ data: { humanTakeover: true }, error: null });
      }

      // 3. Load phone number for promptSections
      const phoneNumber = await findPhoneNumberById(conversation.phoneNumberId);
      const promptSections = phoneNumber?.promptSections ?? null;

      // 4. Load recent messages from DB and map to callAIWithHistory format
      const dbMessages = await getLastNMessages(conversationId, MAX_CONTEXT_MESSAGES);
      const historyMessages = dbMessages.map((m) => ({
        role: m.role === 'user' ? 'customer' : 'bot',
        content: m.body,
      }));

      // 5. Call AI
      let aiResponse;
      try {
        aiResponse = await callAIWithHistory(historyMessages, newMessage, promptSections, imageData);
      } catch (err) {
        request.log.error({ err }, 'Test-prompt AI call failed');
        return reply.code(502).send({ data: null, error: 'AI_UNAVAILABLE' });
      }

      const escalate = !!aiResponse.escalationReason || detectHumanRequest(newMessage);

      // 6. Save the customer message to DB
      await insertMessage({
        conversationId,
        role: 'user',
        body: imageData ? `[Foto] ${newMessage}`.trim() : newMessage,
        waMessageId: undefined,
        senderName: null,
      });

      if (escalate) {
        // 7a. Update conversation status + save bot escalation notice
        await updateConversationStatus(
          conversationId,
          'escalated',
          aiResponse.escalationReason
        );
        if (aiResponse.message) {
          await insertMessage({
            conversationId,
            role: 'assistant',
            body: aiResponse.message,
            senderName: null,
          });
        }
      } else {
        // 7b. Save bot reply
        await insertMessage({
          conversationId,
          role: 'assistant',
          body: aiResponse.message,
          senderName: null,
        });
      }

      // 8. Build context for systemPrompt display
      const context = await buildContextForTest(
        conversation.phoneNumberId,
        newMessage,
        promptSections
      );

      return reply.send({
        data: {
          conversationId,
          reply: aiResponse.message || null,
          escalate,
          reason: aiResponse.escalationReason,
          confidence: aiResponse.confidence,
          topics: aiResponse.topicsDetected ?? [],
          imageUrls: aiResponse.imageUrls ?? [],
          sendPoForm: aiResponse.sendPoForm ?? false,
          catalogUrl: aiResponse.catalogUrl ?? null,
          systemPrompt: context.systemPrompt,
        },
        error: null,
      });
    }

    // ── In-memory path (no conversationId) ─────────────────────────────────
    const phoneNumber = await findPhoneNumberById(phoneNumberId);
    const promptSections = phoneNumber?.promptSections ?? null;

    let aiResponse, context;
    try {
      [aiResponse, context] = await Promise.all([
        callAIWithHistory(messages, newMessage, promptSections, imageData),
        buildContextForTest(phoneNumberId, newMessage, promptSections),
      ]);
    } catch (err) {
      request.log.error({ err }, 'Test-prompt AI call failed');
      return reply.code(502).send({ data: null, error: 'AI_UNAVAILABLE' });
    }

    const escalate = !!aiResponse.escalationReason || detectHumanRequest(newMessage);

    return reply.send({
      data: {
        reply: aiResponse.message || null,
        escalate,
        reason: aiResponse.escalationReason,
        confidence: aiResponse.confidence,
        topics: aiResponse.topicsDetected ?? [],
        imageUrls: aiResponse.imageUrls ?? [],
        sendPoForm: aiResponse.sendPoForm ?? false,
        catalogUrl: aiResponse.catalogUrl ?? null,
        systemPrompt: context.systemPrompt,
      },
      error: null,
    });
  });

  // GET /api/v1/test-prompt/conversations
  app.get(
    '/api/v1/test-prompt/conversations',
    { preHandler: [apiKeyAuth] },
    async (_request, reply) => {
      const items = await listTestConversations();
      return reply.send({
        data: items.map((c) => ({
          id: c.id,
          phoneNumberLabel: c.phoneNumberLabel,
          phoneNumberId: c.phoneNumberId,
          status: c.status,
          messageCount: c.messageCount,
          updatedAt: c.updatedAt,
        })),
        error: null,
      });
    }
  );
}
