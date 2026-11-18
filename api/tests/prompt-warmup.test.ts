/**
 * prompt-warmup.test.ts
 * warmPromptCache() must send the documented pre-warm shape (max_tokens: 0) with the
 * SAME cached tier as real traffic — cache_control'd system prefix, full tools array —
 * or it warms nothing. Guards: no-op under dev mode or legacy RAG.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
const mockIsDevMode = vi.fn(() => false);
const mockIsFullCatalogEnabled = vi.fn(() => true);

vi.mock('../src/services/claude.js', () => ({
  CLAUDE_MODEL: 'claude-test-model',
  getClient: () => ({ messages: { create: mockCreate } }),
  isDevMode: mockIsDevMode,
  isFullCatalogEnabled: mockIsFullCatalogEnabled,
  agentQuery: vi.fn(),
  logUsageLine: vi.fn(),
}));
vi.mock('../src/services/ragQuery.js', () => ({
  getFullCatalogBlock: vi.fn(async () => 'Produk: Test Product'),
  buildCatalogContext: vi.fn(async () => ''),
}));
vi.mock('../src/repositories/appSettings.js', () => ({
  getDefaultPromptSections: vi.fn(async () => [{ name: 'Identity', content: 'Kamu adalah Admin' }]),
}));
vi.mock('../src/repositories/products.js', () => ({
  listBrands: vi.fn(async () => []),
}));
vi.mock('../src/repositories/conversations.js', () => ({
  getLastNMessages: vi.fn(),
  getConversationSummary: vi.fn(),
  updateConversationSummary: vi.fn(),
  countConversationMessages: vi.fn(),
  getMessagesForSummary: vi.fn(),
}));
vi.mock('../src/services/replyChecks.js', () => ({ verifyReplyPrices: vi.fn() }));

const { warmPromptCache } = await import('../src/services/aiLayer.js');

beforeEach(() => {
  mockCreate.mockReset();
  mockCreate.mockResolvedValue({ content: [], stop_reason: 'max_tokens', usage: {} });
  mockIsDevMode.mockReturnValue(false);
  mockIsFullCatalogEnabled.mockReturnValue(true);
});

describe('warmPromptCache', () => {
  it('sends a max_tokens: 0 request with the cached system prefix and the real tools array', async () => {
    await warmPromptCache();

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const req = mockCreate.mock.calls[0][0];
    expect(req.model).toBe('claude-test-model');
    expect(req.max_tokens).toBe(0);
    // The whole byte-stable prefix (identity..catalog) in one cache_control'd block,
    // 1h TTL — identical to toSystemBlocks' output for real traffic.
    expect(req.system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(req.system[0].text).toContain('--- AKHIR KATALOG ---');
    // Same tools as callViaAPI, same order — a different list is a different cache tier.
    expect(req.tools.map((t: { name: string }) => t.name)).toEqual([
      'web_search', 'resolve_link', 'hitung_harga', 'respond_to_customer',
    ]);
  });

  it('is a no-op in dev mode and under legacy RAG', async () => {
    mockIsDevMode.mockReturnValue(true);
    await warmPromptCache();
    expect(mockCreate).not.toHaveBeenCalled();

    mockIsDevMode.mockReturnValue(false);
    mockIsFullCatalogEnabled.mockReturnValue(false);
    await warmPromptCache();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('never throws — a failed warmup costs nothing', async () => {
    mockCreate.mockRejectedValue(new Error('api down'));
    await expect(warmPromptCache()).resolves.toBeUndefined();
  });
});
