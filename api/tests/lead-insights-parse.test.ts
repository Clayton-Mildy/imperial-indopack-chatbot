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
const mockLeadUpdate = vi.fn(async () => undefined);
vi.mock('../src/repositories/contactProfiles.js', () => ({ fillContactProfileGaps: mockFill, upsertContactProfile: vi.fn() }));
vi.mock('../src/repositories/leads.js', () => ({
  applyAiLeadUpdate: mockLeadUpdate,
  findCurrentLeadForContact: vi.fn(async () => null),
  applyLeadStage: vi.fn(async () => false),
  reopenOrRenewLostLead: vi.fn(),
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

  it('keeps every good field when one value is the wrong shape', async () => {
    modelSays('{"is_sales_conversation": true, "customer_type": "end user", "lead_temperature": "warm", "product_sought": "Engsel tanam", "quantity": 300, "business_name": null}');
    expect(await extractLeadInsights('Pelanggan: engsel tanam 300 ya')).toEqual({
      is_sales_conversation: true,
      customer_type: 'end_user',
      lead_temperature: 'hot',
      lead_kind: null, stage: null, evidence: null, lost_reason: null,
      product_sought: 'Engsel tanam',
      quantity: '300',
      business_name: null,
    });
  });

  it('drops only the field it cannot map, and reads "unknown" as no value', async () => {
    modelSays('```json\n{"is_sales_conversation": "true", "customer_type": "unknown", "lead_temperature": "lukewarm", "product_sought": ["Handle", "Engsel"]}\n```');
    const got = await extractLeadInsights('x');
    expect(got).toMatchObject({ is_sales_conversation: true, customer_type: null, lead_temperature: null, product_sought: 'Handle, Engsel' });
  });

  it('maps order numbers back to the customer messages, ignoring numbers that are not one', async () => {
    const { extractOrderMessageIds } = await import('../src/services/leadInsights.js');
    const row = (id: string, role: string, body: string) => ({ id, role, body, senderName: null }) as never;
    const rows = [row('a', 'user', 'halo'), row('b', 'assistant', 'ada yang bisa dibantu?'), row('c', 'user', 'Pesan Grendel 2 dos'), row('d', 'user', 'ambil 20 set')];
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
    await applyLeadInsights('c1', { is_sales_conversation: null, lead_kind: null, stage: null, evidence: null, lost_reason: null, customer_type: 'project', lead_temperature: null, product_sought: 'Floorhinge', quantity: null, business_name: null });
    expect(mockFill).toHaveBeenCalledWith('c1', { customerType: 'project', facts: { product_sought: 'Floorhinge' } });
  });

  // Live 2026-10-09 (Ika): the model said cold AND "not a sale" for a product we don't carry.
  it('still lets a cold verdict replace a Hot, even on a chat it calls "not a sale"', async () => {
    await applyLeadInsights('c1', { is_sales_conversation: false, lead_kind: 'lainnya', stage: null, evidence: null, lost_reason: null, customer_type: 'reseller', lead_temperature: 'cold', product_sought: null, quantity: null, business_name: 'Toko Delima' });
    expect(mockLeadUpdate).toHaveBeenCalledWith('c1', { temperature: 'cold' });
    expect(mockFill).not.toHaveBeenCalled();
  });

  it('writes nothing for an explicit "not a sale"', async () => {
    await applyLeadInsights('c1', { is_sales_conversation: false, lead_kind: 'lainnya', stage: null, evidence: null, lost_reason: null, customer_type: 'project', lead_temperature: 'hot', product_sought: 'x', quantity: null, business_name: null });
    expect(mockFill).not.toHaveBeenCalled();
    expect(mockLeadUpdate).not.toHaveBeenCalled();
  });
});

// Live 2026-10-08: Ika wanted PTA roofing screws, staff answered "kami tidak menyediakan", and the
// lead still read Hot. The rule lives in the prompt; this pins that it says so.
it('tells the model a lead for a product we do not sell is cold, not hot', async () => {
  modelSays('{"lead_kind": "lead"}');
  await extractLeadInsights('x');
  const system = mockCreate.mock.calls[0]![0].system as string;
  expect(system).toMatch(/tidak kami jual/);
  expect(system).toMatch(/"cold"[^\n]*tidak tersedia/);
  // ...and that such a customer is still a buyer, or the cold is never written (Ika, 2026-10-09).
  expect(system).toMatch(/barang yang tidak kami jual tetap lead/);
});
