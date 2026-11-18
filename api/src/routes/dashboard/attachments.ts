import type { FastifyInstance } from 'fastify';
import { apiKeyAuth } from '../../middleware/apiKey.js';
import { findConversationById, insertMessage } from '../../repositories/conversations.js';
import { findPhoneNumberById } from '../../repositories/phoneNumbers.js';
import { getDb } from '../../db/client.js';
import { contacts } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { sendImageMessage, sendDocumentMessage } from '../../services/whatsappSender.js';
import { join } from 'path';
import { writeFile, mkdir } from 'fs/promises';

const SUPPORTED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export async function attachmentRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/v1/conversations/:id/attachments
  app.post(
    '/api/v1/conversations/:id/attachments',
    { preHandler: [apiKeyAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      // Who sent it, so the bubble reads as staff and not "AI". Optional: an old dashboard omits it.
      const senderName = ((request.query as { senderName?: string }).senderName ?? '').trim().slice(0, 100) || 'Tim CS';

      const data = await request.file();

      if (!data) {
        return reply.code(400).send({ data: null, error: 'NO_FILE' });
      }

      const mimeType = data.mimetype;

      if (!SUPPORTED_MIME_TYPES.has(mimeType)) {
        await data.toBuffer().catch(() => {});
        return reply.code(400).send({ data: null, error: 'UNSUPPORTED_MIME_TYPE' });
      }

      let fileBuffer: Buffer;
      try {
        fileBuffer = await data.toBuffer();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toLowerCase().includes('limit')) {
          return reply.code(413).send({ data: null, error: 'FILE_TOO_LARGE' });
        }
        throw err;
      }

      if (fileBuffer.byteLength > MAX_FILE_SIZE) {
        return reply.code(413).send({ data: null, error: 'FILE_TOO_LARGE' });
      }

      const originalFilename = data.filename || 'attachment';

      const conversation = await findConversationById(id);
      if (!conversation) {
        return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
      }

      const phoneNumber = await findPhoneNumberById(conversation.phoneNumberId);
      if (!phoneNumber) {
        return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
      }

      const db = getDb();
      const [contactRow] = await db
        .select()
        .from(contacts)
        .where(eq(contacts.id, conversation.contactId))
        .limit(1);

      if (!contactRow) {
        return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
      }

      const isImage = IMAGE_MIME_TYPES.has(mimeType);

      // Persist under uploads/ (served at /uploads/) then send via the transport switch — Chakra
      // fetches the file by public link. (Previously hardcoded to the now-removed Baileys sidecar.)
      let sendFailed = false;
      let wamid = '';
      let publicPath: string | null = null;
      try {
        const attachDir = join(process.cwd(), 'uploads', 'attachments');
        await mkdir(attachDir, { recursive: true });
        const safeFilename = `${Date.now()}_${originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        await writeFile(join(attachDir, safeFilename), fileBuffer);
        publicPath = `/uploads/attachments/${safeFilename}`;

        wamid = isImage
          ? await sendImageMessage(phoneNumber.phoneNumberId, contactRow.waId, publicPath, '')
          : await sendDocumentMessage(phoneNumber.phoneNumberId, contactRow.waId, publicPath, originalFilename);
      } catch (err) {
        request.log.warn({ err }, 'Attachment send failed');
        sendFailed = true;
      }

      const message = await insertMessage({
        conversationId: id,
        role: 'assistant',
        body: `[Lampiran: ${originalFilename}]`,
        // Stored under its wamid, or chakraSync would import the same file again as a second bubble.
        waMessageId: wamid || undefined,
        status: sendFailed ? 'failed' : 'sent',
        senderName,
        metadata: {
          attachmentType: isImage ? 'image' : 'document',
          filename: originalFilename,
          mimeType,
          ...(publicPath && { mediaUrl: publicPath }),
        },
      });

      return reply.send({ data: message, error: null });
    }
  );
}
