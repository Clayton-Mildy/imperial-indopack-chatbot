import type { FastifyInstance } from 'fastify';
import { writeFile, mkdir } from 'fs/promises';
import { join, extname } from 'path';
import { randomUUID } from 'crypto';
import { apiKeyAuth } from '../../middleware/apiKey.js';

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;  // 5 MB
const CATALOG_MAX_BYTES = 20 * 1024 * 1024; // 20 MB

export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/v1/upload/image
  app.post(
    '/api/v1/upload/image',
    { preHandler: [apiKeyAuth] },
    async (request, reply) => {
      const data = await request.file();

      if (!data) {
        return reply.code(400).send({ data: null, error: 'NO_FILE' });
      }

      if (!IMAGE_MIME_TYPES.has(data.mimetype)) {
        await data.toBuffer().catch(() => {});
        return reply.code(400).send({ data: null, error: 'UNSUPPORTED_MIME_TYPE' });
      }

      let buffer: Buffer;
      try {
        buffer = await data.toBuffer();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toLowerCase().includes('limit')) {
          return reply.code(413).send({ data: null, error: 'FILE_TOO_LARGE' });
        }
        throw err;
      }

      if (buffer.byteLength > IMAGE_MAX_BYTES) {
        return reply.code(413).send({ data: null, error: 'FILE_TOO_LARGE' });
      }

      const ext = extname(data.filename) || '.bin';
      const filename = `${randomUUID()}${ext}`;
      const dir = join(process.cwd(), 'uploads', 'images');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, filename), buffer);

      return reply.send({ data: { url: `/uploads/images/${filename}` }, error: null });
    }
  );

  // POST /api/v1/upload/catalog
  app.post(
    '/api/v1/upload/catalog',
    { preHandler: [apiKeyAuth] },
    async (request, reply) => {
      const data = await request.file();

      if (!data) {
        return reply.code(400).send({ data: null, error: 'NO_FILE' });
      }

      if (data.mimetype !== 'application/pdf') {
        await data.toBuffer().catch(() => {});
        return reply.code(400).send({ data: null, error: 'UNSUPPORTED_MIME_TYPE' });
      }

      let buffer: Buffer;
      try {
        buffer = await data.toBuffer();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toLowerCase().includes('limit')) {
          return reply.code(413).send({ data: null, error: 'FILE_TOO_LARGE' });
        }
        throw err;
      }

      if (buffer.byteLength > CATALOG_MAX_BYTES) {
        return reply.code(413).send({ data: null, error: 'FILE_TOO_LARGE' });
      }

      const ext = extname(data.filename) || '.pdf';
      const filename = `${randomUUID()}${ext}`;
      const dir = join(process.cwd(), 'uploads', 'catalogs');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, filename), buffer);

      return reply.send({ data: { url: `/uploads/catalogs/${filename}` }, error: null });
    }
  );
}
