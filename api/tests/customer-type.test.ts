/**
 * customer-type.test.ts
 * Buyer type decides which price the bot may quote, and the model writes it free-hand into a
 * plain text column with no DB enum. Two things have to hold at once: a value the model spells
 * its own way must still be understood (pickProfileGapQuestion only tests truthiness, so
 * dropping "End User" would make the bot re-ask a question it already had the answer to), and
 * genuine garbage must not be stored as a buyer type.
 *
 * Mocked - no DATABASE_URL.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUpsertContactProfile = vi.fn(async () => undefined);
vi.mock('../src/repositories/contactProfiles.js', () => ({ upsertContactProfile: mockUpsertContactProfile }));
vi.mock('../src/repositories/conversations.js', () => ({ updateConversationFollowUp: vi.fn(async () => undefined) }));
// saveConversationInsights also routes lead-level keys to `leads` now - stub it out so this
// file stays DB-free. What it does with those keys is tests/lead-insights.test.ts.
vi.mock('../src/repositories/leads.js', () => ({ applyAiLeadUpdate: vi.fn(async () => undefined) }));

const { saveConversationInsights } = await import('../src/services/conversationInsights.js');

async function storedTypeFor(customerType: unknown): Promise<unknown> {
  mockUpsertContactProfile.mockClear();
  await saveConversationInsights('conv-1', 'contact-1', {
    message: 'ok',
    confidence: 'high',
    profileUpdate: { customer_type: customerType, name: 'Budi' },
  } as Parameters<typeof saveConversationInsights>[2]);
  return (mockUpsertContactProfile.mock.calls[0]?.[1] as { customerType?: unknown })?.customerType;
}

describe('customer_type from the model', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stores the three canonical values unchanged', async () => {
    expect(await storedTypeFor('end_user')).toBe('end_user');
    expect(await storedTypeFor('reseller')).toBe('reseller');
    expect(await storedTypeFor('project')).toBe('project');
  });

  it('normalises the spellings the model actually produces', async () => {
    expect(await storedTypeFor('End User')).toBe('end_user');
    expect(await storedTypeFor('end-user')).toBe('end_user');
    expect(await storedTypeFor('  RESELLER ')).toBe('reseller');
    expect(await storedTypeFor('proyek')).toBe('project');
    expect(await storedTypeFor('kontraktor')).toBe('project');
  });

  it('drops a value it cannot map, rather than storing it as a buyer type', async () => {
    expect(await storedTypeFor('belum jelas')).toBeUndefined();
    expect(await storedTypeFor('')).toBeUndefined();
    expect(await storedTypeFor(42)).toBeUndefined();
    expect(await storedTypeFor(null)).toBeUndefined();
  });

  it('still writes the rest of the profile when the type is unusable', async () => {
    await storedTypeFor('belum jelas');
    expect(mockUpsertContactProfile.mock.calls[0][1]).toMatchObject({ profilePatch: { name: 'Budi' } });
  });
});

// UAT F-06/F-08: profile_update only carries what the model thinks is NEW, so a buyer type stated
// turns earlier was often never written - and without it no tier line, no end-user price check.
// The type is now its own required field, answered every turn.
describe('customer_type as its own field', () => {
  beforeEach(() => vi.clearAllMocks());

  const save = (over: Record<string, unknown>) =>
    saveConversationInsights('conv-1', 'contact-1', {
      message: 'ok',
      confidence: 'high',
      ...over,
    } as Parameters<typeof saveConversationInsights>[2]);

  it('is saved even when the turn has no other profile facts', async () => {
    await save({ customerType: 'end_user' });
    expect(mockUpsertContactProfile).toHaveBeenCalledTimes(1);
    expect((mockUpsertContactProfile.mock.calls[0] as unknown[])[1]).toMatchObject({ customerType: 'end_user' });
  });

  it('wins over the profile_update copy', async () => {
    await save({ customerType: 'reseller', profileUpdate: { customer_type: 'end_user', city: 'Sidoarjo' } });
    expect((mockUpsertContactProfile.mock.calls[0] as unknown[])[1]).toMatchObject({ customerType: 'reseller' });
  });

  it('"unknown" (null) never overwrites a stored type', async () => {
    await save({ customerType: null, profileUpdate: { name: 'Budi' } });
    expect((mockUpsertContactProfile.mock.calls[0] as unknown[])[1]).toMatchObject({ customerType: undefined });
    mockUpsertContactProfile.mockClear();
    await save({ customerType: null });
    expect(mockUpsertContactProfile).not.toHaveBeenCalled();
  });

  it('understands the Indonesian answers to the buyer-type question', async () => {
    expect(await storedTypeFor('pengguna akhir')).toBe('end_user');
    expect(await storedTypeFor('sendiri')).toBe('end_user');
    expect(await storedTypeFor('pribadi')).toBe('end_user');
  });
});
