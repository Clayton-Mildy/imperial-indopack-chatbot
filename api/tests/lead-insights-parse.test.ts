/**
 * lead-insights-parse.test.ts
 *
 * How the background lead pass reads the model's answer (services/leadInsights.ts). The first
 * backfill on 2026-10-08 logged a run of "unreadable answer" lines: one odd value - a number where
 * a string was expected, a buyer type in other words - threw the whole answer away, so those chats
 * stayed blank and, being stamped as read, were never tried again.
 *
 * Mocked - no DATABASE_URL.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
vi.mock('../src/services/claude.js', () => ({
  getClient: () => ({ messages: { create: mockCreate } }),
  isDevMode: () => false,
  agentQuery: vi.fn(),
  logUsageLine: vi.fn(),
  CLAUDE_MODEL: 'test-model',
}));
const mockFill = vi.fn(async () => undefined);
const mockMerge = vi.fn(async () => undefined);
const mockLeadUpdate = vi.fn(async () => undefined);
vi.mock('../src/repositories/contactProfiles.js', () => ({ fillContactProfileGaps: mockFill, upsertContactProfile: vi.fn() }));
vi.mock('../src/repositories/leads.js', () => ({
  applyAiLeadUpdate: mockLeadUpdate,
  findCurrentLeadForContact: vi.fn(async () => null),
  applyLeadStage: vi.fn(async () => false),
  reopenOrRenewLostLead: vi.fn(),
  applyLeadOrderSnapshot: mockMerge,
}));
vi.mock('../src/repositories/conversations.js', () => ({
  getLastNMessages: vi.fn(), listConversationsDueForInsights: vi.fn(), markInsightsExtracted: vi.fn(),
  updateConversationFollowUp: vi.fn(),
}));

const { extractLeadInsights, applyLeadInsights } = await import('../src/services/leadInsights.js');

function modelSays(text: string) {
  mockCreate.mockResolvedValue({ content: [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 1 } });
}

describe('reading the model answer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads di_bawah_minimum as a lost reason', async () => {
    modelSays('{"lead_kind":"lead","stage":"lost","lost_reason":"di_bawah_minimum"}');
    expect((await extractLeadInsights('Pelanggan: kurang dari minimum ya'))?.lost_reason).toBe('di_bawah_minimum');
  });

  it('keeps every good field when one value is the wrong shape', async () => {
    modelSays('{"is_sales_conversation": true, "lead_temperature": "warm", "name": "Budi", "business_name": null, "brands": "kertas_supreme", "items": [{"product": "Box", "qty": "300"}]}');
    expect(await extractLeadInsights('Pelanggan: box 300 ya')).toEqual({
      is_sales_conversation: true,
      lead_temperature: 'hot',
      lead_kind: null, stage: null, evidence: null, lost_reason: null,
      name: 'Budi',
      business_name: null,
      brands: [],
      items: [{ product: 'Box', qty: '300' }],
    });
  });

  it('parses brands and items, dropping an unknown brand', async () => {
    modelSays('{"lead_kind":"lead","brands":["kertas_supreme","brand_lain"],"items":[{"product":"Kertas Supreme 64 gsm","size":"30x30","qty":10,"qty_unit":"rim"}]}');
    const r = (await extractLeadInsights('x'))!;
    expect(r.brands).toEqual(['kertas_supreme']);
    expect(r.items[0]!.qty).toBe(10);
  });

  it('drops only the field it cannot map, and reads "unknown" as no value', async () => {
    modelSays('```json\n{"is_sales_conversation": "true", "lead_temperature": "lukewarm", "items": "box"}\n```');
    const got = await extractLeadInsights('x');
    expect(got).toMatchObject({ is_sales_conversation: true, lead_temperature: null, items: [] });
  });

  it('maps order numbers back to the customer messages, ignoring numbers that are not one', async () => {
    const { extractOrderMessageIds } = await import('../src/services/leadInsights.js');
    const row = (id: string, role: string, body: string) => ({ id, role, body, senderName: null }) as never;
    const rows = [row('a', 'user', 'halo'), row('b', 'assistant', 'ada yang bisa dibantu?'), row('c', 'user', 'Pesan box nasi 2000 pcs'), row('d', 'user', 'ambil 20 rim')];
    modelSays('```json\n{"orders": [2, "3", 2, 7]}\n```');
    expect(await extractOrderMessageIds(rows)).toEqual(['c', 'd']);
    modelSays('Maaf, tidak bisa.');
    expect(await extractOrderMessageIds(rows)).toBeNull();
  });

  it('still gives up on an answer that is not JSON at all', async () => {
    modelSays('Maaf, saya tidak bisa membaca percakapan ini.');
    expect(await extractLeadInsights('x')).toBeNull();
  });
});

describe('reading the CRM fields', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lowercases a stage and reads the evidence as given', async () => {
    modelSays('{"lead_kind": "lead", "stage": "Won", "evidence": "oke saya ambil", "lost_reason": null}');
    expect(await extractLeadInsights('x')).toMatchObject({ lead_kind: 'lead', stage: 'won', evidence: 'oke saya ambil', lost_reason: null });
  });

  it('drops a lost_reason and a stage it cannot map', async () => {
    modelSays('{"lead_kind": "lead", "stage": "maybe", "lost_reason": "price"}');
    expect(await extractLeadInsights('x')).toMatchObject({ stage: null, lost_reason: null });
  });

  it('reads an old answer with only is_sales_conversation:false as kind lainnya', async () => {
    modelSays('{"is_sales_conversation": false}');
    expect(await extractLeadInsights('x')).toMatchObject({ lead_kind: 'lainnya' });
  });

  it('asks for the six kinds and the proof rules', async () => {
    modelSays('{}');
    await extractLeadInsights('x');
    const system = mockCreate.mock.calls[0]![0].system as string;
    expect(system).toMatch(/barang yang tidak kami jual tetap lead/);
    expect(system).toMatch(/diam \/ tidak membalas BUKAN lost/);
    expect(system).not.toMatch(/is_sales_conversation/);
    expect(system).toMatch(/salin PERSIS satu pesan Pelanggan/);
  });
});

describe('writing what was read', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes the fields of an answer that left out is_sales_conversation', async () => {
    await applyLeadInsights('c1', { is_sales_conversation: null, lead_kind: null, stage: null, evidence: null, lost_reason: null, lead_temperature: null, name: 'Budi', brands: [], items: [], business_name: 'Toko Delima' });
    expect(mockFill).toHaveBeenCalledWith('c1', { facts: { name: 'Budi', business_name: 'Toko Delima' } });
  });

  // The model can say cold AND "not a sale" for a product we don't carry.
  it('still lets a cold verdict replace a Hot, even on a chat it calls "not a sale"', async () => {
    await applyLeadInsights('c1', { is_sales_conversation: false, lead_kind: 'lainnya', stage: null, evidence: null, lost_reason: null, lead_temperature: 'cold', name: null, brands: [], items: [], business_name: 'Toko Delima' });
    expect(mockLeadUpdate).toHaveBeenCalledWith('c1', { temperature: 'cold' });
    expect(mockFill).not.toHaveBeenCalled();
  });

  it('writes nothing for an explicit "not a sale"', async () => {
    await applyLeadInsights('c1', { is_sales_conversation: false, lead_kind: 'lainnya', stage: null, evidence: null, lost_reason: null, lead_temperature: 'hot', name: null, brands: ['kertas_supreme'], items: [{ product: 'x' }], business_name: null });
    expect(mockFill).not.toHaveBeenCalled();
    expect(mockLeadUpdate).not.toHaveBeenCalled();
  });
});

it('asks about Imperial Indopack and Kertas Supreme, not the old hardware business', async () => {
  modelSays('{}');
  await extractLeadInsights('x');
  const system = mockCreate.mock.calls[0]![0].system as string;
  expect(system).toMatch(/Imperial Indopack \/ Kertas Supreme \(box karton dan kertas bungkus makanan cetak\)/);
  expect(system).not.toMatch(/Legacy|customer_type|product_sought/);
  expect(system).toContain('"oke saya ambil 10 rim"');
  expect(system).not.toMatch(/lusin/);
});

// Task 13 carry: the order prompt's examples were hardware (Meteran, Kuas cat, lusin).
it('gives the order call box and paper examples', async () => {
  const { extractOrderMessageIds } = await import('../src/services/leadInsights.js');
  modelSays('{"orders": []}');
  await extractOrderMessageIds([{ id: 'a', role: 'user', body: 'halo', senderName: null }] as never);
  const system = mockCreate.mock.calls.at(-1)![0].system as string;
  expect(system).toMatch(/box nasi 20x20 2000 pcs/);
  expect(system).toMatch(/10 rim yg 64 gsm/);
  expect(system).not.toMatch(/Meteran|Kuas|lusin|silver/i);
});

// Task 13 carry: a name the model did not find, written as a word, is no name.
describe('a name the model did not find', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['unknown', 'Unknown', 'tidak diketahui', '-', ' - ', 'null', 'none', 'tidak disebutkan', 'Belum diketahui', 'N/A'])('reads %j as no name and no business', async (v) => {
    modelSays(JSON.stringify({ lead_kind: 'lead', name: v, business_name: v }));
    expect(await extractLeadInsights('x')).toMatchObject({ name: null, business_name: null });
  });

  it('keeps a real name, and writes no "unknown" to the profile', async () => {
    modelSays('{"lead_kind": "lead", "name": "Budi", "business_name": "unknown"}');
    const r = (await extractLeadInsights('x'))!;
    expect(r).toMatchObject({ name: 'Budi', business_name: null });
    await applyLeadInsights('c1', r);
    expect(mockFill).toHaveBeenCalledWith('c1', { facts: { name: 'Budi' } });
  });
});

// A customer asking for an item we do not sell, told so by staff, must not read Hot. The rule lives in
// the prompt; this pins that it says so.
it('tells the model a lead for a product we do not sell is cold, not hot', async () => {
  modelSays('{"lead_kind": "lead"}');
  await extractLeadInsights('x');
  const system = mockCreate.mock.calls[0]![0].system as string;
  expect(system).toMatch(/tidak kami jual/);
  expect(system).toMatch(/"cold"[^\n]*tidak tersedia/);
  // ...and that such a customer is still a buyer, or the cold is never written.
  expect(system).toMatch(/barang yang tidak kami jual tetap lead/);
});
