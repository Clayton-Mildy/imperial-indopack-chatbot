/**
 * uploads-inbound-headers.test.ts
 *
 * Files customers send are written to uploads/inbound under their own names (Plan 2 Task 10) and
 * served from /uploads on the same hostname as the dashboard (the /app proxy). A document named
 * "x.html" or "x.svg" must never render there as a page: that would run a customer's script on the
 * dashboard's origin when staff open the file. So everything under inbound/ is nosniff, and anything
 * that is not a plain photo is sent as a download.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { buildApp } from '../src/app.js';

const DIR = join(process.cwd(), 'uploads', 'inbound');
const NAMES = ['__hdr_test_page.html', '__hdr_test_logo.svg', '__hdr_test_desain.pdf', '__hdr_test_foto.jpg'];
let prevUpstream: string | undefined;

beforeAll(async () => {
  prevUpstream = process.env['DASHBOARD_UPSTREAM'];
  process.env['DASHBOARD_UPSTREAM'] = '';
  await mkdir(DIR, { recursive: true });
  for (const n of NAMES) await writeFile(join(DIR, n), n.endsWith('.html') ? '<script>alert(1)</script>' : 'contoh');
});

afterAll(async () => {
  if (prevUpstream === undefined) delete process.env['DASHBOARD_UPSTREAM'];
  else process.env['DASHBOARD_UPSTREAM'] = prevUpstream;
  for (const n of NAMES) await rm(join(DIR, n), { force: true });
});

async function get(name: string) {
  const app = buildApp();
  try {
    return await app.inject({ method: 'GET', url: `/uploads/inbound/${name}` });
  } finally {
    await app.close();
  }
}

describe('serving customer files', () => {
  it.each(['__hdr_test_page.html', '__hdr_test_logo.svg', '__hdr_test_desain.pdf'])('%s is a download, never rendered', async (name) => {
    const res = await get(name);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('a photo still shows inline (the thread and the panel show it as an image)', async () => {
    const res = await get('__hdr_test_foto.jpg');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
