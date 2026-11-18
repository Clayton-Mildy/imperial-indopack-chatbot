/**
 * customer-type.test.ts
 * Imperial Indopack's price does not depend on who buys (spec 7.3), so the turn no longer records a
 * buyer type: respond_to_customer has no customer_type field, and a stray customer_type key in
 * profile_update is neither stored as the type nor written into the profile. The column
 * contact_profiles.customer_type stays, unused by the turn.
 *
 * Mocked - no DATABASE_URL.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUpsertContactProfile = vi.fn(async () => undefined);
vi.mock('../src/repositories/contactProfiles.js', () => ({ upsertContactProfile: mockUpsertContactProfile }));
vi.mock('../src/repositories/conversations.js', () => ({ updateConversationFollowUp: vi.fn(async () => undefined) }));
// saveConversationInsights also routes lead-level keys to `leads` - stub it out so this file stays
// DB-free. What it does with those keys is tests/lead-insights.test.ts.
vi.mock('../src/repositories/leads.js', () => ({ applyAiLeadUpdate: vi.fn(async () => undefined) }));

const { saveConversationInsights } = await import('../src/services/conversationInsights.js');

const save = (over: Record<string, unknown>) =>
  saveConversationInsights('conv-1', 'contact-1', {
    message: 'ok',
    confidence: 'high',
    ...over,
  } as Parameters<typeof saveConversationInsights>[2]);

describe('the turn records no buyer type', () => {
  beforeEach(() => vi.clearAllMocks());

  it('a customer_type in profile_update is dropped; the rest of the profile is saved', async () => {
    await save({ profileUpdate: { customer_type: 'reseller', name: 'Budi' } });
    expect(mockUpsertContactProfile).toHaveBeenCalledTimes(1);
    const fill = (mockUpsertContactProfile.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(fill['customerType']).toBeUndefined();
    expect(fill['profilePatch']).toEqual({ name: 'Budi' });
  });

  it('a turn with nothing else to save writes no profile', async () => {
    await save({ customerType: 'end_user' });
    expect(mockUpsertContactProfile).not.toHaveBeenCalled();
  });
});
