/**
 * catalog-images-route.test.ts
 *
 * POST /api/v1/catalog/images takes a batch of photos as one multipart request - the dashboard sends
 * a picked folder this way, a few files at a time. Real Fastify + @fastify/multipart, so the parsing
 * is exercised; the importer, the key check and the catalog cache are stubbed.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';

const mockImport = vi.fn(async (files: { filename: string }[]) =>
  files.map((f) => ({ file: f.filename, status: 'matched', target: { kind: 'product', id: 'p', label: f.filename } })));
vi.mock('../src/services/catalogImages.js', () => ({ importCatalogImages: mockImport }));
vi.mock('../src/middleware/apiKey.js', () => ({ apiKeyAuth: async () => {} }));
const mockInvalidate = vi.fn();
vi.mock('../src/services/ragQuery.js', () => ({ invalidateCatalogCache: mockInvalidate, getFullCatalogBlock: async () => '' }));

const { catalogRoutes } = await import('../src/routes/dashboard/catalog.js');

async function app() {
  const a = Fastify();
  await a.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });
  await a.register(catalogRoutes);
  return a;
}

async function multipartBody(files: { name: string; type: string }[]) {
  const fd = new FormData();
  for (const f of files) fd.append('files', new Blob([Buffer.from('x')], { type: f.type }), f.name);
  const req = new Request('http://local/', { method: 'POST', body: fd });
  return { payload: Buffer.from(await req.arrayBuffer()), headers: { 'content-type': req.headers.get('content-type')! } };
}

afterEach(() => vi.clearAllMocks());

describe('POST /api/v1/catalog/images', () => {
  it('passes every image of the batch to the importer and refreshes the AI catalog', async () => {
    const a = await app();
    const res = await a.inject({ method: 'POST', url: '/api/v1/catalog/images', ...(await multipartBody([
      { name: 'GEMBOK BULAT PUTIH.jpg', type: 'image/jpeg' },
      { name: 'LS2140 L.png', type: 'image/png' },
    ])) });
    expect(res.statusCode).toBe(200);
    expect(mockImport.mock.calls[0]![0].map((f) => f.filename)).toEqual(['GEMBOK BULAT PUTIH.jpg', 'LS2140 L.png']);
    expect(res.json().data.results).toHaveLength(2);
    expect(mockInvalidate).toHaveBeenCalled();
    await a.close();
  });

  it('rejects a file that is not an image, and anything past ten files in one request', async () => {
    const a = await app();
    const files = [{ name: 'daftar.pdf', type: 'application/pdf' }, ...Array.from({ length: 11 }, (_, i) => ({ name: `P${i}.jpg`, type: 'image/jpeg' }))];
    const res = await a.inject({ method: 'POST', url: '/api/v1/catalog/images', ...(await multipartBody(files)) });
    const results = res.json().data.results as { file: string; status: string; reason?: string }[];
    expect(mockImport.mock.calls[0]![0]).toHaveLength(9);
    expect(results.filter((r) => r.status === 'rejected').map((r) => r.file)).toEqual(['daftar.pdf', 'P9.jpg', 'P10.jpg']);
    await a.close();
  });

  it('answers 400 to a request with no files', async () => {
    const a = await app();
    const res = await a.inject({ method: 'POST', url: '/api/v1/catalog/images', ...(await multipartBody([])) });
    expect(res.statusCode).toBe(400);
    await a.close();
  });
});
