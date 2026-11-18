/**
 * lead-insights.test.ts
 *
 * The AI now maintains four fields on the LEAD row (temperature, pipeline status, order
 * count, deal value) through the same free-form `profile_update` bag it already used for the
 * contact profile. Two things have to hold, and they pull in opposite directions:
 *
 *  - those four keys must be routed to `leads` and must NOT leak into contact_profiles.profile,
 *    where they would render as stray rows in the conversation sidebar; and
 *  - a value the model spells its own way must still be understood, while genuine garbage must
 *    never reach a column the marketing report aggregates.
 *
 * Mocked - no DATABASE_URL.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUpsertContactProfile = vi.fn(async () => undefined);
const mockApplyAiLeadUpdate = vi.fn(async () => undefined);
vi.mock('../src/repositories/contactProfiles.js', () => ({ upsertContactProfile: mockUpsertContactProfile }));
vi.mock('../src/repositories/leads.js', () => ({ applyAiLeadUpdate: mockApplyAiLeadUpdate }));
vi.mock('../src/repositories/conversations.js', () => ({ updateConversationFollowUp: vi.fn(async () => undefined) }));

const { saveConversationInsights } = await import('../src/services/conversationInsights.js');

type LeadPatch = {
  temperature?: string;
  status?: string;
  orderConfirmed?: boolean;
  orderValueIdr?: number;
};

async function leadPatchFor(profileUpdate: Record<string, unknown>): Promise<LeadPatch> {
  mockApplyAiLeadUpdate.mockClear();
  mockUpsertContactProfile.mockClear();
  await saveConversationInsights('conv-1', 'contact-1', {
    message: 'ok',
    confidence: 'high',
    profileUpdate,
  } as Parameters<typeof saveConversationInsights>[2]);
  return (mockApplyAiLeadUpdate.mock.calls[0]?.[1] ?? {}) as LeadPatch;
}

describe('lead_temperature from the model', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stores both canonical values unchanged', async () => {
    expect((await leadPatchFor({ lead_temperature: 'hot' })).temperature).toBe('hot');
    expect((await leadPatchFor({ lead_temperature: 'cold' })).temperature).toBe('cold');
  });

  it('normalises the spellings the model actually produces', async () => {
    expect((await leadPatchFor({ lead_temperature: 'HOT' })).temperature).toBe('hot');
    expect((await leadPatchFor({ lead_temperature: '  Panas ' })).temperature).toBe('hot');
    expect((await leadPatchFor({ lead_temperature: 'dingin' })).temperature).toBe('cold');
    // The UI offers two buckets - a lead worth calling warm belongs on the chased side.
    expect((await leadPatchFor({ lead_temperature: 'warm' })).temperature).toBe('hot');
  });

  it('drops a value it cannot map rather than storing it as a temperature', async () => {
    expect((await leadPatchFor({ lead_temperature: 'lumayan' })).temperature).toBeUndefined();
    expect((await leadPatchFor({ lead_temperature: '' })).temperature).toBeUndefined();
    expect((await leadPatchFor({ lead_temperature: 7 })).temperature).toBeUndefined();
  });
});

describe('lead_status from the model', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is ignored: the stage is set by rules and staff, never by the model', async () => {
    for (const status of ['new', 'contacted', 'quoted', 'won', 'lost', 'menang']) {
      expect((await leadPatchFor({ lead_status: status })).status).toBeUndefined();
    }
  });
});

describe('order tracking', () => {
  beforeEach(() => vi.clearAllMocks());

  it('banks the value only when an order was actually confirmed', async () => {
    const patch = await leadPatchFor({ order_confirmed: true, order_value_idr: 450000 });
    expect(patch.orderConfirmed).toBe(true);
    expect(patch.orderValueIdr).toBe(450000);
  });

  it('counts the order even when the model could not price it', async () => {
    const patch = await leadPatchFor({ order_confirmed: true });
    expect(patch.orderConfirmed).toBe(true);
    expect(patch.orderValueIdr).toBeUndefined();
  });

  it('ignores a value with no confirmed order - that is a quote, not a deal', async () => {
    const patch = await leadPatchFor({ order_value_idr: 450000 });
    expect(patch.orderConfirmed).toBe(false);
    expect(patch.orderValueIdr).toBeUndefined();
  });

  it('rejects a value that is not a usable rupiah figure', async () => {
    expect((await leadPatchFor({ order_confirmed: true, order_value_idr: 0 })).orderValueIdr).toBeUndefined();
    expect((await leadPatchFor({ order_confirmed: true, order_value_idr: -5 })).orderValueIdr).toBeUndefined();
    expect((await leadPatchFor({ order_confirmed: true, order_value_idr: 'mahal' })).orderValueIdr).toBeUndefined();
    // Written as a string with separators, which the model does do.
    expect((await leadPatchFor({ order_confirmed: true, order_value_idr: 'Rp 450000' })).orderValueIdr).toBe(450000);
  });
});

describe('routing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps the lead keys out of the contact profile jsonb', async () => {
    await leadPatchFor({
      lead_temperature: 'hot',
      lead_status: 'quoted',
      order_confirmed: true,
      order_value_idr: 1000,
      customer_type: 'reseller',
      name: 'Budi',
    });
    const profileArg = mockUpsertContactProfile.mock.calls[0]?.[1] as {
      profilePatch?: Record<string, unknown>;
    };
    expect(profileArg.profilePatch).toEqual({ name: 'Budi' });
  });

  it('does not touch the lead when the model reported nothing about it', async () => {
    const patch = await leadPatchFor({ name: 'Budi' });
    expect(patch.temperature).toBeUndefined();
    expect(patch.status).toBeUndefined();
    expect(patch.orderConfirmed).toBe(false);
  });
});
