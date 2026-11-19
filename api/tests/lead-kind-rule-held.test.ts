import { describe, it, expect } from 'vitest';
import { planLeadInsights, type LeadInsights } from '../src/services/leadInsights.js';
import type { Lead, Message } from '../src/domain/types.js';

const lead = (over: Partial<Lead>): Lead => ({
  id: 'l1', contactId: 'c1', status: 'new', kind: 'kurir', kindSetBy: 'rule', humanUpdatedAt: null, lostReason: null,
  closedAt: null, brands: [], items: [], firstContactAt: new Date(), submittedAt: new Date(), updatedAt: new Date(), createdAt: new Date(),
  ...over,
} as Lead);
const insights = (kind: LeadInsights['lead_kind']): LeadInsights => ({
  is_sales_conversation: null, lead_kind: kind, stage: null, evidence: null, lost_reason: null, lead_temperature: null,
  name: null, business_name: null, brands: [], items: [],
});
const rows: Message[] = [{ id: 'm1', conversationId: 'cv', role: 'user', body: 'Paket untuk gudang Jatinegara, penerimanya siapa kak?', waMessageId: null, status: null, senderName: null, metadata: null, createdAt: new Date() }];
const kindSteps = (l: Lead, i: LeadInsights) => planLeadInsights(l, i, rows, 90).steps.filter((s) => s.op === 'stage' && s.change.kind !== undefined);

describe('a non-buyer kind the live rule set', () => {
  it('is not swapped for another non-buyer kind by the lead pass', () => {
    expect(kindSteps(lead({}), insights('status_pesanan'))).toHaveLength(0);
  });
  it('is still corrected to lead when the rule misfired on a buyer', () => {
    expect(kindSteps(lead({}), insights('lead'))).toHaveLength(1);
  });
  it('a kind the model itself set can still change', () => {
    expect(kindSteps(lead({ kindSetBy: 'ai' }), insights('status_pesanan'))).toHaveLength(1);
  });
});
