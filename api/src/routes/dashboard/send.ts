import type { FastifyInstance } from 'fastify';
import { apiKeyAuth } from '../../middleware/apiKey.js';
import { SendMessageBodySchema } from '../../domain/schemas.js';
import { findConversationById, insertMessage } from '../../repositories/conversations.js';
import { findPhoneNumberById } from '../../repositories/phoneNumbers.js';
import { sendTextMessage } from '../../services/whatsappSender.js';
import { getDb } from '../../db/client.js';
import { contacts } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { markHumanTakeover } from '../../services/humanTakeover.js';

export async function sendRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/v1/send
  app.post('/api/v1/send', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const result = SendMessageBodySchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    }

    const { conversationId, body, senderName } = result.data;

    const conversation = await findConversationById(conversationId);
    if (!conversation) {
      return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
    }

    const phoneNumber = await findPhoneNumberById(conversation.phoneNumberId);
    if (!phoneNumber) {
      return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
    }

    // Get customer WA ID from contact
    const db = getDb();
    const [contactRow] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, conversation.contactId))
      .limit(1);

    if (!contactRow) {
      return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
    }

    // Try to send via WhatsApp — best-effort for demo (may fail if token expired or account restricted)
    let sentId: string | null = null;
    try {
      sentId = await sendTextMessage(phoneNumber.phoneNumberId, contactRow.waId, body);
    } catch (err) {
      request.log.warn({ err }, 'Meta API send failed — message saved to DB only');
    }

    const message = await insertMessage({
      conversationId,
      role: 'assistant',
      body,
      waMessageId: sentId || undefined,
      status: sentId ? 'sent' : 'saved',
      senderName: senderName ?? null,
    });

    // Same rule as an agent replying in Chakra's inbox: whoever answers owns the conversation,
    // and the AI stops. Also clears an `escalated` badge - someone has picked this up - and takes a
    // resolved chat back, or the customer's next message would reopen it to the bot.
    await markHumanTakeover(conversationId, senderName ?? 'Tim CS', { includeResolved: true }).catch(() => { });

    return reply.send({ data: message, error: null });
  });
}
