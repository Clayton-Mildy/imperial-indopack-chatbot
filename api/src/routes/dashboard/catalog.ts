import type { FastifyInstance } from 'fastify';
import type { StockStatus } from '../../domain/types.js';
import { apiKeyAuth } from '../../middleware/apiKey.js';
import {
  listUom,
  listBrands,
  createBrand,
  updateBrand,
  deleteBrand,
  createUom,
  updateUom,
  deleteUom,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  createVariant,
  updateVariant,
  deleteVariant,
} from '../../repositories/products.js';
import { refreshEmbeddingAsync } from '../../services/embeddings.js';
import { buildCatalogWorkbook } from '../../services/catalogExport.js';
import { importCatalogFromXlsx, InvalidXlsxError } from '../../services/catalogImport.js';
import { storeUploadedImage } from '../../services/imageStorage.js';
import {
  MAX_REFERENCE_IMAGES_PER_PRODUCT,
  addReferenceImage,
  countReferenceImages,
  deleteReferenceImageIfExists,
  productExists,
} from '../../repositories/referenceImages.js';
import { importCatalogImages, type ImageFileResult } from '../../services/catalogImages.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Per request, not per folder: the dashboard sends a folder in batches of this many photos.
const IMAGE_BATCH_MAX_FILES = 10;
import { getFullCatalogBlock, invalidateCatalogCache } from '../../services/ragQuery.js';
import {
  CreateBrandBodySchema,
  PatchBrandBodySchema,
  CreateUomBodySchema,
  PatchUomBodySchema,
  CreateCategoryBodySchema,
  PatchCategoryBodySchema,
  CreateProductBodySchema,
  PatchProductBodySchema,
  CreateVariantBodySchema,
  PatchVariantBodySchema,
} from '../../domain/schemas.js';

// Copied from routes/dashboard/leads.ts rather than hoisted: two call sites is not yet a module.
const XLSX_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream', // some browsers send this for .xlsx
]);
const XLSX_MAX_BYTES = 5 * 1024 * 1024;

export async function catalogRoutes(app: FastifyInstance): Promise<void> {
  // Any successful mutation in this file (POST/PATCH/DELETE, any route present or
  // future) can change what getFullCatalogBlock() memoizes — one hook invalidates
  // it for all of them instead of a call at the end of every handler.
  app.addHook('onResponse', async (request, reply) => {
    if (request.method !== 'GET' && reply.statusCode < 400) {
      invalidateCatalogCache();
      // Rebuild in the background so the next customer message never blocks on it;
      // the in-flight dedup in getFullCatalogBlock shares this build with any real request.
      getFullCatalogBlock().catch(() => { });
    }
  });

  // GET /api/v1/catalog/export - whole catalog as .xlsx.
  // Binary, so no { data, error } envelope.
  app.get('/api/v1/catalog/export', { preHandler: [apiKeyAuth] }, async (_request, reply) => {
    const workbook = await buildCatalogWorkbook();
    const date = new Date().toISOString().slice(0, 10);
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="katalog-imperial-indopack-${date}.xlsx"`)
      .send(workbook);
  });

  // POST /api/v1/catalog/import - the export, edited and uploaded back.
  //
  // Lives in this file so the onResponse hook above invalidates the rendered catalog block for
  // free. Update-in-place: a product in the database but absent from the file is left alone and
  // counted as `untouched`, so a human who filtered the sheet cannot empty the catalog.
  app.post('/api/v1/catalog/import', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.code(400).send({ data: null, error: 'NO_FILE' });

    const looksXlsx = XLSX_MIME_TYPES.has(data.mimetype) || data.filename?.toLowerCase().endsWith('.xlsx');
    if (!looksXlsx) {
      await data.toBuffer().catch(() => {});  // drain, or the connection hangs
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
    if (buffer.byteLength > XLSX_MAX_BYTES) {
      return reply.code(413).send({ data: null, error: 'FILE_TOO_LARGE' });
    }

    try {
      const result = await importCatalogFromXlsx(buffer);
      return reply.send({ data: result, error: null });
    } catch (err) {
      // Only "your file is broken" is a 400; anything else is ours and stays a 500.
      if (err instanceof InvalidXlsxError) {
        return reply.code(400).send({ data: null, error: 'INVALID_XLSX' });
      }
      throw err;
    }
  });

  // POST /api/v1/catalog/images - a batch of catalog photos, each named after a product or a variant
  // code (services/catalogImages.ts). The dashboard sends a picked folder in batches of a few files,
  // so one request stays far below the tunnel's body limit; the per-request cap enforces that.
  app.post('/api/v1/catalog/images', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const files: { filename: string; buffer: Buffer }[] = [];
    const rejected: ImageFileResult[] = [];
    for await (const part of request.files()) {
      if (files.length + rejected.length >= IMAGE_BATCH_MAX_FILES) {
        await part.toBuffer().catch(() => {}); // drain, or the connection hangs
        rejected.push({ file: part.filename, status: 'rejected', reason: `lebih dari ${IMAGE_BATCH_MAX_FILES} file dalam satu kiriman` });
        continue;
      }
      if (!part.mimetype.startsWith('image/')) {
        await part.toBuffer().catch(() => {});
        rejected.push({ file: part.filename, status: 'rejected', reason: 'bukan file gambar' });
        continue;
      }
      try {
        files.push({ filename: part.filename, buffer: await part.toBuffer() });
      } catch {
        rejected.push({ file: part.filename, status: 'rejected', reason: 'file terlalu besar' });
      }
    }
    if (files.length + rejected.length === 0) return reply.code(400).send({ data: null, error: 'NO_FILE' });
    const results = [...(await importCatalogImages(files)), ...rejected];
    return reply.send({ data: { results }, error: null });
  });

  // POST /api/v1/products/:id/reference-images - one design-reference photo (max 3 per product);
  // the bot sends these as examples. Stored the way the catalog photos are.
  app.post<{ Params: { id: string } }>('/api/v1/products/:id/reference-images', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const { id } = request.params;
    const part = await request.file();
    if (!part) return reply.code(400).send({ data: null, error: 'NO_FILE' });
    if (!part.mimetype.startsWith('image/')) {
      await part.toBuffer().catch(() => {});
      return reply.code(400).send({ data: null, error: 'UNSUPPORTED_MIME_TYPE' });
    }
    let buffer: Buffer;
    try {
      buffer = await part.toBuffer();
    } catch {
      return reply.code(413).send({ data: null, error: 'FILE_TOO_LARGE' });
    }
    if (!UUID_RE.test(id) || !(await productExists(id))) {
      return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
    }
    if ((await countReferenceImages(id)) >= MAX_REFERENCE_IMAGES_PER_PRODUCT) {
      return reply.code(409).send({ data: null, error: 'REFERENCE_IMAGE_LIMIT' });
    }
    let imageUrl: string;
    try {
      imageUrl = await storeUploadedImage(buffer);
    } catch {
      return reply.code(400).send({ data: null, error: 'INVALID_IMAGE' });
    }
    const { id: imageId } = await addReferenceImage(id, imageUrl);
    invalidateCatalogCache();
    return reply.code(201).send({ data: { id: imageId, imageUrl }, error: null });
  });

  // DELETE /api/v1/reference-images/:id
  app.delete<{ Params: { id: string } }>('/api/v1/reference-images/:id', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const { id } = request.params;
    if (!UUID_RE.test(id) || !(await deleteReferenceImageIfExists(id))) {
      return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
    }
    invalidateCatalogCache();
    return reply.code(204).send();
  });

  // GET /api/v1/uom
  app.get('/api/v1/uom', { preHandler: [apiKeyAuth] }, async (_request, reply) => {
    const data = await listUom();
    return reply.send({ data, error: null });
  });

  // POST /api/v1/uom
  app.post('/api/v1/uom', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const result = CreateUomBodySchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    }
    try {
      const uom = await createUom(result.data.name, result.data.description);
      return reply.code(201).send({ data: uom, error: null });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('unique') || message.includes('duplicate')) {
        return reply.code(409).send({ data: null, error: 'CONFLICT' });
      }
      throw err;
    }
  });

  // PATCH /api/v1/uom/:id
  app.patch<{ Params: { id: string } }>(
    '/api/v1/uom/:id',
    { preHandler: [apiKeyAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const result = PatchUomBodySchema.safeParse(request.body);
      if (!result.success) {
        return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
      }
      try {
        const uom = await updateUom(id, result.data);
        if (!uom) return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
        return reply.send({ data: uom, error: null });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('unique') || message.includes('duplicate')) {
          return reply.code(409).send({ data: null, error: 'CONFLICT' });
        }
        throw err;
      }
    }
  );

  // DELETE /api/v1/uom/:id
  app.delete<{ Params: { id: string } }>(
    '/api/v1/uom/:id',
    { preHandler: [apiKeyAuth] },
    async (request, reply) => {
      const { id } = request.params;
      try {
        const deleted = await deleteUom(id);
        if (!deleted) return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
        return reply.send({ data: { id }, error: null });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message === 'UOM_IN_USE') {
          return reply.code(409).send({ data: null, error: 'UOM_IN_USE' });
        }
        throw err;
      }
    }
  );

  // GET /api/v1/brands
  app.get('/api/v1/brands', { preHandler: [apiKeyAuth] }, async (_request, reply) => {
    const data = await listBrands();
    return reply.send({ data, error: null });
  });

  // POST /api/v1/brands
  app.post('/api/v1/brands', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const result = CreateBrandBodySchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    }
    try {
      const brand = await createBrand(result.data.name, result.data.description);
      return reply.code(201).send({ data: brand, error: null });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('unique') || message.includes('duplicate')) {
        return reply.code(409).send({ data: null, error: 'CONFLICT' });
      }
      throw err;
    }
  });

  // PATCH /api/v1/brands/:id
  app.patch<{ Params: { id: string } }>(
    '/api/v1/brands/:id',
    { preHandler: [apiKeyAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const result = PatchBrandBodySchema.safeParse(request.body);
      if (!result.success) {
        return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
      }
      try {
        const brand = await updateBrand(id, result.data);
        if (!brand) return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
        return reply.send({ data: brand, error: null });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('unique') || message.includes('duplicate')) {
          return reply.code(409).send({ data: null, error: 'CONFLICT' });
        }
        throw err;
      }
    }
  );

  // DELETE /api/v1/brands/:id
  app.delete<{ Params: { id: string } }>(
    '/api/v1/brands/:id',
    { preHandler: [apiKeyAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const deleted = await deleteBrand(id);
      if (!deleted) return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
      return reply.send({ data: { id }, error: null });
    }
  );

  // GET /api/v1/categories
  app.get('/api/v1/categories', { preHandler: [apiKeyAuth] }, async (_request, reply) => {
    const data = await listCategories();
    return reply.send({ data, error: null });
  });

  // POST /api/v1/categories
  app.post('/api/v1/categories', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const result = CreateCategoryBodySchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    }
    try {
      const category = await createCategory(result.data);
      return reply.code(201).send({ data: category, error: null });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('unique') || message.includes('duplicate')) {
        return reply.code(409).send({ data: null, error: 'CONFLICT' });
      }
      throw err;
    }
  });

  // PATCH /api/v1/categories/:id
  app.patch<{ Params: { id: string } }>(
    '/api/v1/categories/:id',
    { preHandler: [apiKeyAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const result = PatchCategoryBodySchema.safeParse(request.body);
      if (!result.success) {
        return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
      }
      try {
        const category = await updateCategory(id, result.data);
        if (!category) return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
        return reply.send({ data: category, error: null });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('unique') || message.includes('duplicate')) {
          return reply.code(409).send({ data: null, error: 'CONFLICT' });
        }
        throw err;
      }
    }
  );

  // DELETE /api/v1/categories/:id
  app.delete<{ Params: { id: string } }>(
    '/api/v1/categories/:id',
    { preHandler: [apiKeyAuth] },
    async (request, reply) => {
      const { id } = request.params;
      try {
        const deleted = await deleteCategory(id);
        if (!deleted) return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
        return reply.send({ data: { id }, error: null });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message === 'CATEGORY_IN_USE') {
          return reply.code(409).send({ data: null, error: 'CATEGORY_IN_USE' });
        }
        throw err;
      }
    }
  );

  // GET /api/v1/products
  app.get('/api/v1/products', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const rawQuery = request.query as Record<string, unknown>;
    const page = Number(rawQuery.page ?? 1);
    const limit = Number(rawQuery.limit ?? 25);
    const brandId = rawQuery.brandId as string | undefined;
    const search = rawQuery.search as string | undefined;
    const status = rawQuery.status as string | undefined;
    const categoryId = rawQuery.categoryId as string | undefined;

    const { products, total } = await listProducts({ page, limit, brandId, search, status, categoryId });
    const totalPages = limit === 0 ? 1 : Math.ceil(total / limit);

    return reply.send({
      data: products,
      error: null,
      meta: { page, limit, total, totalPages },
    });
  });

  // POST /api/v1/products
  app.post('/api/v1/products', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const result = CreateProductBodySchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    }
    try {
      const product = await createProduct(result.data);
      refreshEmbeddingAsync(product.id);
      return reply.code(201).send({ data: product, error: null });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('unique') || msg.includes('duplicate') || (err as { code?: string }).code === '23505') {
        return reply.code(409).send({ data: null, error: 'CONFLICT' });
      }
      throw err;
    }
  });

  // GET /api/v1/products/:id
  app.get<{ Params: { id: string } }>(
    '/api/v1/products/:id',
    { preHandler: [apiKeyAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const product = await getProduct(id);
      if (!product) return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
      return reply.send({ data: product, error: null });
    }
  );

  // PATCH /api/v1/products/:id
  app.patch<{ Params: { id: string } }>(
    '/api/v1/products/:id',
    { preHandler: [apiKeyAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const result = PatchProductBodySchema.safeParse(request.body);
      if (!result.success) {
        return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
      }
      try {
        const product = await updateProduct(id, result.data);
        if (!product) return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
        refreshEmbeddingAsync(product.id);
        return reply.send({ data: product, error: null });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('unique') || msg.includes('duplicate') || (err as { code?: string }).code === '23505') {
          return reply.code(409).send({ data: null, error: 'CONFLICT' });
        }
        throw err;
      }
    }
  );

  // DELETE /api/v1/products/:id
  app.delete<{ Params: { id: string } }>(
    '/api/v1/products/:id',
    { preHandler: [apiKeyAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const deleted = await deleteProduct(id);
      if (!deleted) return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
      return reply.send({ data: { id }, error: null });
    }
  );

  // POST /api/v1/products/:id/variants
  app.post<{ Params: { id: string } }>(
    '/api/v1/products/:id/variants',
    { preHandler: [apiKeyAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const result = CreateVariantBodySchema.safeParse(request.body);
      if (!result.success) {
        return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
      }
      try {
        const { stockStatus, isActive, ...rest } = result.data;
        const variant = await createVariant(id, {
          ...rest,
          stockStatus: stockStatus as StockStatus,
          isActive,
        });
        refreshEmbeddingAsync(id); // id = productId for this route
        return reply.code(201).send({ data: variant, error: null });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('unique') || msg.includes('duplicate') || (err as { code?: string }).code === '23505') {
          return reply.code(409).send({ data: null, error: 'CONFLICT' });
        }
        throw err;
      }
    }
  );

  // PATCH /api/v1/variants/:id
  app.patch<{ Params: { id: string } }>(
    '/api/v1/variants/:id',
    { preHandler: [apiKeyAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const result = PatchVariantBodySchema.safeParse(request.body);
      if (!result.success) {
        return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
      }
      try {
        const { stockStatus, ...patchRest } = result.data;
        const variant = await updateVariant(id, {
          ...patchRest,
          ...(stockStatus ? { stockStatus: stockStatus as StockStatus } : {}),
        });
        if (!variant) return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
        refreshEmbeddingAsync(variant.productId);
        return reply.send({ data: variant, error: null });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('unique') || msg.includes('duplicate') || (err as { code?: string }).code === '23505') {
          return reply.code(409).send({ data: null, error: 'CONFLICT' });
        }
        throw err;
      }
    }
  );

  // DELETE /api/v1/variants/:id
  app.delete<{ Params: { id: string } }>(
    '/api/v1/variants/:id',
    { preHandler: [apiKeyAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const deleted = await deleteVariant(id);
      if (!deleted) return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
      return reply.send({ data: { id }, error: null });
    }
  );
}
