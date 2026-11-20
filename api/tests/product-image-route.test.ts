/**
 * product-image-route.test.ts - POST/DELETE /api/v1/products/:id/image through Fastify inject.
 * The product photo (products.image_url) is what the bot compares customers' photos with; the dashboard
 * sets it here. Needs DATABASE_URL; creates and removes its own products and the files it stores.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import 'dotenv/config';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import sharp from 'sharp';
import { rm } from 'fs/promises';
import { join } from 'path';
import { eq } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { brands, productPhotos, products } from '../src/db/schema.js';

vi.mock('../src/middleware/apiKey.js', () => ({ apiKeyAuth: async () => {} }));

const { catalogRoutes } = await import('../src/routes/dashboard/catalog.js');

const TAG = '__prodimg__';

async function png(): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer();
}

async function upload(buf: Buffer, type: string, name: string, url: string) {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type }), name);
  const req = new Request('http://local/', { method: 'POST', body: fd });
  return { method: 'POST' as const, url, payload: Buffer.from(await req.arrayBuffer()), headers: { 'content-type': req.headers.get('content-type')! } };
}

describe('product photo routes', () => {
  const app = Fastify();
  const madeProducts: string[] = [];
  const stored: string[] = [];
  let brandId: string;
  let productId: string;

  async function imageUrlOf(id: string): Promise<string | null> {
    const [row] = await getDb().select({ u: products.imageUrl }).from(products).where(eq(products.id, id));
    return row!.u;
  }

  beforeAll(async () => {
    await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });
    await app.register(catalogRoutes);
    const db = getDb();
    const [b] = await db.insert(brands).values({ name: `${TAG}brand` }).returning();
    brandId = b!.id;
    const [p] = await db.insert(products).values({ brandId, name: `Box ${TAG} (CONTOH)` }).returning();
    productId = p!.id;
    madeProducts.push(productId);
  });

  afterAll(async () => {
    const db = getDb();
    for (const id of madeProducts) await db.delete(products).where(eq(products.id, id));
    await db.delete(brands).where(eq(brands.id, brandId));
    for (const u of stored) await rm(join(process.cwd(), u), { force: true });
    await app.close();
  });

  const photoIds: string[] = [];
  async function add(name: string) {
    const res = await app.inject(await upload(await png(), 'image/png', name, `/api/v1/products/${productId}/image`));
    if (res.statusCode === 201) {
      const d = res.json().data as { id: string; imageUrl: string };
      stored.push(d.imageUrl);
      photoIds.push(d.id);
    }
    return res;
  }

  it('upload adds a photo (201) and image_url is the first one', async () => {
    const res = await add('a.png');
    expect(res.statusCode).toBe(201);
    const { data, error } = res.json();
    expect(error).toBeNull();
    expect(data.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(data.imageUrl).toMatch(/^\/uploads\/images\/[0-9a-f-]+\.jpg$/);
    expect(await imageUrlOf(productId)).toBe(data.imageUrl);
  });

  it('a second and third upload add photos; image_url stays the first', async () => {
    const first = await imageUrlOf(productId);
    expect((await add('b.png')).statusCode).toBe(201);
    expect((await add('c.png')).statusCode).toBe(201);
    expect(await imageUrlOf(productId)).toBe(first);
    const rows = await getDb().select().from(productPhotos).where(eq(productPhotos.productId, productId));
    expect(rows).toHaveLength(3);
  });

  it('a fourth upload is refused with 409 PRODUCT_PHOTO_LIMIT and stores nothing', async () => {
    const res = await add('d.png');
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('PRODUCT_PHOTO_LIMIT');
    const rows = await getDb().select().from(productPhotos).where(eq(productPhotos.productId, productId));
    expect(rows).toHaveLength(3);
  });

  it('deleting the first photo moves image_url to the next one (204)', async () => {
    const second = (await getDb().select().from(productPhotos).where(eq(productPhotos.id, photoIds[1]!)))[0]!;
    const res = await app.inject({ method: 'DELETE', url: `/api/v1/product-photos/${photoIds[0]}` });
    expect(res.statusCode).toBe(204);
    expect(await imageUrlOf(productId)).toBe(second.imageUrl);
  });

  it('deleting a later photo keeps image_url; deleting the last clears it', async () => {
    const keep = await imageUrlOf(productId);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/product-photos/${photoIds[2]}` })).statusCode).toBe(204);
    expect(await imageUrlOf(productId)).toBe(keep);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/product-photos/${photoIds[1]}` })).statusCode).toBe(204);
    expect(await imageUrlOf(productId)).toBeNull();
  });

  it('the limit frees up after a delete', async () => {
    expect((await add('e.png')).statusCode).toBe(201);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/product-photos/${photoIds[3]}` })).statusCode).toBe(204);
    expect(await imageUrlOf(productId)).toBeNull();
  });

  it('404 for an unknown product or photo, and for a bad id', async () => {
    const ghost = '00000000-0000-4000-8000-000000000000';
    const up = await app.inject(await upload(await png(), 'image/png', 'a.png', `/api/v1/products/${ghost}/image`));
    expect(up.statusCode).toBe(404);
    expect(up.json().error).toBe('NOT_FOUND');
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/product-photos/${ghost}` });
    expect(del.statusCode).toBe(404);
    const bad = await app.inject({ method: 'DELETE', url: '/api/v1/product-photos/not-a-uuid' });
    expect(bad.statusCode).toBe(404);
  });

  it('400 for a non-image file, and nothing is set', async () => {
    const res = await app.inject(await upload(Buffer.from('hello'), 'text/plain', 'a.txt', `/api/v1/products/${productId}/image`));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('UNSUPPORTED_MIME_TYPE');
    expect(await imageUrlOf(productId)).toBeNull();
  });

  it('400 INVALID_IMAGE for an image mime type with unreadable bytes', async () => {
    const res = await app.inject(await upload(Buffer.from('not really a png'), 'image/png', 'a.png', `/api/v1/products/${productId}/image`));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_IMAGE');
  });
});
