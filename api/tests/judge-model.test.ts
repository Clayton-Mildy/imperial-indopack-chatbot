/**
 * judge-model.test.ts
 * Fix Plan R-01: the fit judge runs on JUDGE_MODEL (Sonnet 5 by default) because Haiku misread the
 * catalog in about half its UAT Run 3 rejections. The credential the live bot ran on answers 429
 * for every non-Haiku model, so an unreachable judge model must fall back to the reply model, never
 * fail the turn. No network: the client is scripted.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('../src/services/claude.js', () => ({
  getClient: () => ({ messages: { create } }),
  isDevMode: () => false,
  isFullCatalogEnabled: () => true,
  agentQuery: vi.fn(),
  logUsageLine: vi.fn(),
  CLAUDE_MODEL: 'claude-haiku-4-5-20251001',
}));

import { verifyFit } from '../src/services/aiLayer.js';

const PROMPT = `--- KATALOG PRODUK ---
Merek: Vintage
Kategori: Door Pull
Produk: DOORPULL 35CM VINTAGE BLUE PERTH
[DATA KATALOG RESMI - otoritatif untuk kecocokan]
Fungsi: Sebagai pegangan pintu, khususnya pada pintu kayu.
Varian:
  - BLACK/CP , SC/CP: Rp 105.000/Set | MP: Rp 147.000/Set
--- AKHIR KATALOG ---`;

const draft = { message: 'DOORPULL 35CM VINTAGE BLUE PERTH ada kak, Rp 147.000/Set.', confidence: 'high' as const, customerType: 'end_user' as const };
const noRepair = { regenerate: async () => { throw new Error('no repair expected'); } };
const approve = { content: [{ type: 'text', text: '{"ok": true, "reason": ""}' }], usage: { input_tokens: 1, output_tokens: 1 } };
const rateLimited = () => new Anthropic.RateLimitError(429, { type: 'error', error: { type: 'rate_limit_error' } }, 'Error', new Headers());

describe('judge model', () => {
  beforeEach(() => create.mockReset());

  it('judges on Sonnet 5 without temperature (it rejects sampling params) and with thinking off', async () => {
    create.mockResolvedValueOnce(approve);
    await verifyFit(draft, PROMPT, 'handle pintu kayu', noRepair);
    const [params, options] = create.mock.calls[0]!;
    expect(params.model).toBe('claude-sonnet-5-5');
    expect(params).not.toHaveProperty('temperature');
    expect(params.thinking).toEqual({ type: 'disabled' });
    expect(options).toEqual({ maxRetries: 0 });
  });

  it('falls back to the reply model at once when the judge model is refused, then leaves it alone', async () => {
    create.mockRejectedValueOnce(rateLimited()).mockResolvedValue(approve);
    const out = await verifyFit(draft, PROMPT, 'handle pintu kayu', noRepair);
    expect(out.confidence).toBe('high');
    expect(create.mock.calls.map(([p]) => p.model)).toEqual(['claude-sonnet-5-5', 'claude-haiku-4-5-20251001']);
    expect(create.mock.calls[1]![0].temperature).toBe(0);

    await verifyFit(draft, PROMPT, 'handle pintu kayu', noRepair);
    expect(create.mock.calls.map(([p]) => p.model).slice(2)).toEqual(['claude-haiku-4-5-20251001']);
  });
});
