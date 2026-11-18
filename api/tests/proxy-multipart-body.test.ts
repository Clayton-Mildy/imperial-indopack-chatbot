import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildApp } from '../src/app.js';

// Every dashboard upload (Import Excel, product images, catalog PDFs, attachments) is a
// multipart POST that rides browser -> API /app proxy -> Next route handler. The API's own
// @fastify/multipart parser used to claim those requests inside the proxy scope and swallow
// the body, so Next received 0 bytes and every upload 500'd. This drives the real buildApp().
describe('dashboard proxy', () => {
  let upstream: http.Server;
  let prevUpstream: string | undefined;

  beforeAll(async () => {
    // Stands in for Next: reports how much body actually arrived.
    upstream = http.createServer((req, res) => {
      let bytes = 0;
      req.on('data', (c: Buffer) => (bytes += c.length));
      req.on('end', () => res.end(JSON.stringify({ bytes, contentType: req.headers['content-type'] })));
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    prevUpstream = process.env['DASHBOARD_UPSTREAM'];
    process.env['DASHBOARD_UPSTREAM'] = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (prevUpstream === undefined) delete process.env['DASHBOARD_UPSTREAM'];
    else process.env['DASHBOARD_UPSTREAM'] = prevUpstream;
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  it('forwards a multipart upload body to the dashboard intact', async () => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(60_000)]), 'katalog.xlsx');
    const req = new Request('http://localhost', { method: 'POST', body: form });
    const payload = Buffer.from(await req.arrayBuffer());
    const contentType = req.headers.get('content-type')!;

    const app = buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/app/api/catalog-import',
        payload,
        headers: { 'content-type': contentType },
      });
      expect(res.statusCode).toBe(200);
      const seen = res.json() as { bytes: number; contentType: string };
      expect(seen.bytes).toBe(payload.length);
      // The boundary must survive too, or Next cannot split the parts.
      expect(seen.contentType).toBe(contentType);
    } finally {
      await app.close();
    }
  });
});
