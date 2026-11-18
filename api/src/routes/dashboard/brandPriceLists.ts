import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { basename, join } from 'path';
import { apiKeyAuth } from '../../middleware/apiKey.js';
import { BRAND_NAME, BRAND_SLUGS } from '../../domain/brands.js';
import type { BrandSlug } from '../../domain/orderProfile.js';
import { listBrandPriceLists, listBrands, setBrandPriceList } from '../../repositories/products.js';
import { invalidateCatalogOnWrite } from './catalogCache.js';

// As POST /api/v1/upload/catalog (uploads.ts): one PDF, at most 20 MB, stored as uploads/catalogs/<uuid>.pdf.
const PDF_MAX_BYTES = 20 * 1024 * 1024;
const CATALOGS_DIR = join(process.cwd(), 'uploads', 'catalogs');
/** A file this API stored: /uploads/catalogs/<one plain name>. Anything else is never deleted. */
const STORED_URL_RE = /^\/uploads\/catalogs\/([0-9A-Za-z_-][0-9A-Za-z._-]*)$/;
const MAX_FILE_NAME = 200;

const NOT_FOUND = { data: null, error: 'NOT_FOUND' };
const UNSUPPORTED = { data: null, error: 'UNSUPPORTED_MIME_TYPE' };
const TOO_LARGE = { data: null, error: 'FILE_TOO_LARGE' };

const isBrandSlug = (s: string): s is BrandSlug => (BRAND_SLUGS as readonly string[]).includes(s);

/** A PDF starts "%PDF-"; readers accept it anywhere in the first 1 KB, so a renamed image or document does not pass. */
const isPdf = (buf: Buffer): boolean => buf.subarray(0, 1024).includes('%PDF-');

const isTooLarge = (err: unknown): boolean =>
  (err as { code?: string } | null)?.code === 'FST_REQ_FILE_TOO_LARGE' || /limit/i.test(err instanceof Error ? err.message : String(err));

/**
 * The name the customer's phone shows for the document: the uploaded file's own name, without any
 * folder a browser sent along or control characters, ending in .pdf; the brand's default when empty.
 */
function documentName(raw: string | undefined, slug: BrandSlug): string {
  const base = basename((raw ?? '').replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '');
  const [, stem = '', ext = '.pdf'] = /^(.*?)(\.pdf)?$/i.exec(base.trim()) ?? [];
  const name = stem.trim().slice(0, MAX_FILE_NAME);
  return name ? `${name}${ext}` : `Daftar Harga ${BRAND_NAME[slug]}.pdf`;
}

/**
 * Deletes a price-list file this API stored, once no brand row points at it any more. A url outside
 * uploads/catalogs (an external link, a hand-set path) is never touched, nor is a file that is already
 * gone. A failure here is logged, not thrown: the brand row has already moved on.
 */
async function removeStoredFile(url: string | null): Promise<void> {
  const name = url ? STORED_URL_RE.exec(url)?.[1] : undefined;
  if (!name) return;
  if ((await listBrands()).some((b) => b.catalogFileUrl === url)) return;
  await unlink(join(CATALOGS_DIR, name)).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== 'ENOENT') console.warn('[brandPriceLists] could not delete', url, err.message);
  });
}

/**
 * Each brand's price-list PDF on the Katalog page: the file the bot sends when a customer asks for the
 * price list (services/catalogDelivery.ts), under the name it was uploaded with. Replacing or removing
 * one deletes the old file from uploads/catalogs.
 */
export async function brandPriceListRoutes(app: FastifyInstance): Promise<void> {
  // The brand rows are part of what the bot reads: every successful upload or delete refreshes it.
  invalidateCatalogOnWrite(app);

  // GET /api/v1/brands/price-lists - both brands, BRAND_SLUGS order.
  app.get('/api/v1/brands/price-lists', { preHandler: [apiKeyAuth] }, async (_request, reply) => {
    return reply.send({ data: await listBrandPriceLists(), error: null });
  });

  // POST /api/v1/brands/:slug/price-list - multipart, one PDF.
  app.post<{ Params: { slug: string } }>('/api/v1/brands/:slug/price-list', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const { slug } = request.params;
    if (!isBrandSlug(slug)) return reply.code(404).send(NOT_FOUND);

    const data = await request.file();
    if (!data) return reply.code(400).send({ data: null, error: 'NO_FILE' });
    if (data.mimetype !== 'application/pdf') {
      await data.toBuffer().catch(() => {}); // drain, or the connection hangs
      return reply.code(400).send(UNSUPPORTED);
    }
    let buffer: Buffer;
    try {
      buffer = await data.toBuffer();
    } catch (err) {
      if (isTooLarge(err)) return reply.code(413).send(TOO_LARGE);
      throw err;
    }
    if (buffer.byteLength > PDF_MAX_BYTES) return reply.code(413).send(TOO_LARGE);
    if (!isPdf(buffer)) return reply.code(400).send(UNSUPPORTED);

    const before = (await listBrandPriceLists()).find((p) => p.brand === slug)!;
    const stored = `${randomUUID()}.pdf`;
    const url = `/uploads/catalogs/${stored}`;
    await mkdir(CATALOGS_DIR, { recursive: true });
    await writeFile(join(CATALOGS_DIR, stored), buffer);
    const saved = await setBrandPriceList(slug, { url, fileName: documentName(data.filename, slug) }).catch(async (err: unknown) => {
      await unlink(join(CATALOGS_DIR, stored)).catch(() => {}); // the row never pointed at it
      throw err;
    });
    await removeStoredFile(before.url);
    return reply.send({ data: saved, error: null });
  });

  // DELETE /api/v1/brands/:slug/price-list - the bot then tells customers the list is not available yet.
  app.delete<{ Params: { slug: string } }>('/api/v1/brands/:slug/price-list', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const { slug } = request.params;
    if (!isBrandSlug(slug)) return reply.code(404).send(NOT_FOUND);
    const before = (await listBrandPriceLists()).find((p) => p.brand === slug)!;
    const saved = await setBrandPriceList(slug, null);
    await removeStoredFile(before.url);
    return reply.send({ data: saved, error: null });
  });
}
