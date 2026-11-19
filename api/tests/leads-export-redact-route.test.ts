/**
 * leads-export-redact-route.test.ts
 * GET /api/v1/leads/export?redact=1 - the dashboard's export proxy sets it for a read-only
 * (marketing) session, and the file then carries none of the customer's own text. Mocked - no DB.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({ buildLeadsWorkbook: vi.fn(async () => Buffer.from('xlsx-contoh')) }));

vi.mock('../src/middleware/apiKey.js', () => ({ apiKeyAuth: async () => {} }));
vi.mock('../src/services/leadsExport.js', () => ({ buildLeadsWorkbook: m.buildLeadsWorkbook }));

const Fastify = (await import('fastify')).default;
const { leadRoutes } = await import('../src/routes/dashboard/leads.js');

async function get(url: string) {
  const app = Fastify();
  await app.register(leadRoutes);
  try {
    return await app.inject({ method: 'GET', url });
  } finally {
    await app.close();
  }
}

beforeEach(() => vi.clearAllMocks());

describe('GET /api/v1/leads/export redact', () => {
  it('redact=1 builds the redacted file; the filters still apply and redact is not one of them', async () => {
    const res = await get('/api/v1/leads/export?status=won&redact=1');
    expect(res.statusCode).toBe(200);
    expect(m.buildLeadsWorkbook).toHaveBeenCalledWith({ status: 'won' }, { redact: true });
  });

  it('without redact (or redact=0) the file is whole', async () => {
    await get('/api/v1/leads/export?status=won');
    await get('/api/v1/leads/export?redact=0');
    expect(m.buildLeadsWorkbook.mock.calls).toEqual([
      [{ status: 'won' }, { redact: false }],
      [{}, { redact: false }],
    ]);
  });

  it('any other redact value is a 400', async () => {
    expect((await get('/api/v1/leads/export?redact=ya')).statusCode).toBe(400);
    expect(m.buildLeadsWorkbook).not.toHaveBeenCalled();
  });
});
