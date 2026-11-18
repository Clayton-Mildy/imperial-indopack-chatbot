import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { apiKeyAuth } from '../../middleware/apiKey.js';
import { listCatalogHistory } from '../../repositories/catalogAudit.js';
import {
  ProductDraftSchema,
  ProductNameTakenError,
  createCatalogProduct,
  deleteCatalogProduct,
  getCatalogProduct,
  getProductUsage,
  listCatalogProducts,
  setCatalogProductActive,
  updateCatalogProduct,
  validateProductDraft,
  type Actor,
} from '../../services/catalogEditor.js';
import { invalidateCatalogOnWrite } from './catalogCache.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Who is acting: the dashboard sends the signed-in staff member from its session.
const ActorFields = {
  staffId: z.string().uuid().nullish(),
  staffName: z.string().trim().min(1),
};
const SaveBodySchema = z.object({ draft: ProductDraftSchema, ...ActorFields });
const ActiveBodySchema = z.object({ isActive: z.boolean(), ...ActorFields });
const DeleteQuerySchema = z.object(ActorFields);
const ListQuerySchema = z.object({
  brand: z.enum(['kertas_supreme', 'imperial_indopack']).optional(),
  search: z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

const actorOf = (b: { staffId?: string | null; staffName: string }): Actor => ({ staffId: b.staffId ?? null, name: b.staffName });

const NOT_FOUND = { data: null, error: 'NOT_FOUND' };
const NAME_TAKEN = { data: null, error: 'NAME_TAKEN' };

/**
 * The Katalog product editor (services/catalogEditor.ts). A malformed body is a 400 with no details; a
 * well-formed draft the editor refuses is a 400 whose details name each problem by size and tier index.
 */
export async function catalogProductRoutes(app: FastifyInstance): Promise<void> {
  invalidateCatalogOnWrite(app);

  // GET /api/v1/catalog/products?brand&search&status
  app.get('/api/v1/catalog/products', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const query = ListQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    const { items, counts } = await listCatalogProducts(query.data);
    return reply.send({ data: items, error: null, meta: { counts } });
  });

  // GET /api/v1/catalog/products/:id - the product, its history (newest first) and its use in chats.
  app.get<{ Params: { id: string } }>('/api/v1/catalog/products/:id', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const { id } = request.params;
    if (!UUID_RE.test(id)) return reply.code(404).send(NOT_FOUND);
    const product = await getCatalogProduct(id);
    if (!product) return reply.code(404).send(NOT_FOUND);
    const [history, usage] = await Promise.all([listCatalogHistory(id), getProductUsage(product.name)]);
    return reply.send({ data: { product, history, usage }, error: null });
  });

  // POST /api/v1/catalog/products
  app.post('/api/v1/catalog/products', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const body = SaveBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR', details: [] });
    const checked = validateProductDraft(body.data.draft);
    if (!checked.ok) return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR', details: checked.errors });
    try {
      const product = await createCatalogProduct(checked.input, actorOf(body.data));
      return reply.code(201).send({ data: product, error: null });
    } catch (err) {
      if (err instanceof ProductNameTakenError) return reply.code(409).send(NAME_TAKEN);
      throw err;
    }
  });

  // PUT /api/v1/catalog/products/:id - the whole form; sizes left out are deleted.
  app.put<{ Params: { id: string } }>('/api/v1/catalog/products/:id', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const { id } = request.params;
    if (!UUID_RE.test(id)) return reply.code(404).send(NOT_FOUND);
    const body = SaveBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR', details: [] });
    const checked = validateProductDraft(body.data.draft);
    if (!checked.ok) return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR', details: checked.errors });
    try {
      const product = await updateCatalogProduct(id, checked.input, actorOf(body.data));
      if (!product) return reply.code(404).send(NOT_FOUND);
      return reply.send({ data: product, error: null });
    } catch (err) {
      if (err instanceof ProductNameTakenError) return reply.code(409).send(NAME_TAKEN);
      throw err;
    }
  });

  // PATCH /api/v1/catalog/products/:id/active - switch the bot's offer of it on or off.
  app.patch<{ Params: { id: string } }>('/api/v1/catalog/products/:id/active', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const { id } = request.params;
    if (!UUID_RE.test(id)) return reply.code(404).send(NOT_FOUND);
    const body = ActiveBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    const product = await setCatalogProductActive(id, body.data.isActive, actorOf(body.data));
    if (!product) return reply.code(404).send(NOT_FOUND);
    return reply.send({ data: product, error: null });
  });

  // DELETE /api/v1/catalog/products/:id?staffName=&staffId=
  app.delete<{ Params: { id: string } }>('/api/v1/catalog/products/:id', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const { id } = request.params;
    if (!UUID_RE.test(id)) return reply.code(404).send(NOT_FOUND);
    const query = DeleteQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    const result = await deleteCatalogProduct(id, actorOf(query.data));
    if (!result) return reply.code(404).send(NOT_FOUND);
    return reply.send({ data: result, error: null });
  });
}
