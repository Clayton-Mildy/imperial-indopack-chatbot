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
import { brands, products } from '../src/db/schema.js';

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

  it('upload sets image_url and returns it', async () => {
    const res = await app.inject(await upload(await png(), 'image/png', 'a.png', `/api/v1/products/${productId}/image`));
    expect(res.statusCode).toBe(200);
    const { data, error } = res.json();
    expect(error).toBeNull();
    expect(data.imageUrl).toMatch(/^\/uploads\/images\/[0-9a-f-]+\.jpg$/);
    stored.push(data.imageUrl);
    expect(await imageUrlOf(productId)).toBe(data.imageUrl);
  });

  it('a second upload replaces the first', async () => {
    const before = await imageUrlOf(productId);
    const res = await app.inject(await upload(await png(), 'image/png', 'b.png', `/api/v1/products/${productId}/image`));
    expect(res.statusCode).toBe(200);
    const url = res.json().data.imageUrl as string;
    stored.push(url);
    expect(url).not.toBe(before);
    expect(await imageUrlOf(productId)).toBe(url);
  });

  it('delete clears image_url (204)', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/api/v1/products/${productId}/image` });
    expect(res.statusCode).toBe(204);
    expect(await imageUrlOf(productId)).toBeNull();
  });

  it('404 for an unknown product, on both routes', async () => {
    const ghost = '00000000-0000-4000-8000-000000000000';
    const up = await app.inject(await upload(await png(), 'image/png', 'a.png', `/api/v1/products/${ghost}/image`));
    expect(up.statusCode).toBe(404);
    expect(up.json().error).toBe('NOT_FOUND');
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/products/${ghost}/image` });
    expect(del.statusCode).toBe(404);
    const bad = await app.inject({ method: 'DELETE', url: '/api/v1/products/not-a-uuid/image' });
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
