/**
 * uploads-inbound-headers.test.ts
 *
 * Files customers send are written to uploads/inbound under their own names (Plan 2 Task 10) and
 * served from /uploads on the same hostname as the dashboard (the /app proxy). A document named
 * "x.html" or "x.svg" must never render there as a page: that would run a customer's script on the
 * dashboard's origin when staff open the file. The same holds for every other folder under uploads/
 * (staff attachments kept the client's file name too). So every uploaded file is nosniff, and anything
 * that is not a plain photo is sent as a download - which does not stop Chakra fetching a price-list
 * PDF by its URL.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { buildApp, uploadFileHeaders } from '../src/app.js';
import { storedAttachmentName } from '../src/routes/dashboard/attachments.js';

const DIR = join(process.cwd(), 'uploads', 'inbound');
const NESTED = '__hdr_test_sub';
const NAMES = ['__hdr_test_page.html', '__hdr_test_logo.svg', '__hdr_test_desain.pdf', '__hdr_test_foto.jpg', `${NESTED}/x.html`];
// Files under other upload folders (staff attachments, price lists, product photos).
const OTHER = [join('attachments', '__hdr_test_x.html'), join('catalogs', '__hdr_test_daftar-harga.pdf'), join('images', '__hdr_test_box.jpg')];
let prevUpstream: string | undefined;

beforeAll(async () => {
  prevUpstream = process.env['DASHBOARD_UPSTREAM'];
  process.env['DASHBOARD_UPSTREAM'] = '';
  await mkdir(join(DIR, NESTED), { recursive: true });
  for (const n of NAMES) await writeFile(join(DIR, n), n.endsWith('.html') ? '<script>alert(1)</script>' : 'contoh');
  for (const n of OTHER) {
    await mkdir(join(process.cwd(), 'uploads', n, '..'), { recursive: true });
    await writeFile(join(process.cwd(), 'uploads', n), n.endsWith('.html') ? '<script>alert(1)</script>' : 'contoh');
  }
});

afterAll(async () => {
  if (prevUpstream === undefined) delete process.env['DASHBOARD_UPSTREAM'];
  else process.env['DASHBOARD_UPSTREAM'] = prevUpstream;
  for (const n of NAMES) await rm(join(DIR, n), { force: true });
  await rm(join(DIR, NESTED), { recursive: true, force: true });
  for (const n of OTHER) await rm(join(process.cwd(), 'uploads', n), { force: true });
});

async function get(name: string, folder = 'inbound') {
  const app = buildApp();
  try {
    return await app.inject({ method: 'GET', url: `/uploads/${folder}/${name}` });
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

  it('a file in a folder under inbound/ gets the same headers', async () => {
    const res = await get(`${NESTED}/x.html`);
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

describe('serving every other uploaded file', () => {
  it('a staff attachment named x.html is a download, never rendered', async () => {
    const res = await get('__hdr_test_x.html', 'attachments');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('a price-list PDF is still served by its URL (as a download) for Chakra to fetch', async () => {
    const res = await get('__hdr_test_daftar-harga.pdf', 'catalogs');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe('attachment');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('a product photo still shows inline', async () => {
    const res = await get('__hdr_test_box.jpg', 'images');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

const DOWNLOAD = { 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'attachment' };
const INLINE = { 'X-Content-Type-Options': 'nosniff' };

// Judged by the path inside the uploads folder, so nothing outside it is touched.
describe('uploadFileHeaders', () => {
  it('every file under <uploads>, at any depth: photos inline, everything else a download', () => {
    const root = '/srv/inbound/api/uploads';
    expect(uploadFileHeaders(root, `${root}/inbound/a.pdf`)).toEqual(DOWNLOAD);
    expect(uploadFileHeaders(root, `${root}/inbound/sub/x.html`)).toEqual(DOWNLOAD);
    expect(uploadFileHeaders(root, `${root}/inbound/foto.JPG`)).toEqual(INLINE);
    expect(uploadFileHeaders(root, `${root}/images/box.jpg`)).toEqual(INLINE);
    expect(uploadFileHeaders(root, `${root}/images/box.webp`)).toEqual(INLINE);
    expect(uploadFileHeaders(root, `${root}/catalogs/katalog.pdf`)).toEqual(DOWNLOAD);
    expect(uploadFileHeaders(root, `${root}/attachments/1700000000000_x.html`)).toEqual(DOWNLOAD);
    expect(uploadFileHeaders(root, `${root}/images/logo.svg`)).toEqual(DOWNLOAD);
    expect(uploadFileHeaders(root, '/srv/other/x.html')).toEqual({});
  });

  it('works on Windows paths too', () => {
    expect(uploadFileHeaders('C:\\imperial\\api\\uploads', 'C:\\imperial\\api\\uploads\\attachments\\x.html')).toEqual(DOWNLOAD);
    expect(uploadFileHeaders('C:\\imperial\\api\\uploads', 'C:\\imperial\\api\\uploads\\images\\x.png')).toEqual(INLINE);
  });
});

// The stored name's extension comes from the (allow-listed) MIME type, never the client's file name:
// an "x.html" sent as image/png is stored as .png, so it can never be served as a page.
describe('storedAttachmentName', () => {
  it.each([
    ['x.html', 'image/png', '1700000000000_x.png'],
    ['logo.svg', 'image/jpeg', '1700000000000_logo.jpg'],
    ['Desain Contoh.PDF', 'application/pdf', '1700000000000_Desain_Contoh.pdf'],
    ['penawaran.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '1700000000000_penawaran.docx'],
    ['data.xls', 'application/vnd.ms-excel', '1700000000000_data.xls'],
    ['../../app.ts', 'image/webp', '1700000000000_.._.._app.webp'],
    ['', 'application/pdf', '1700000000000_attachment.pdf'],
  ])('%s sent as %s is stored as %s', (name, mime, stored) => {
    expect(storedAttachmentName(name, mime, 1_700_000_000_000)).toBe(stored);
  });
});
