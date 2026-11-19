/**
 * price-tool-loop.test.ts
 * hitung_harga inside both Claude call paths. Every hitung_harga call in a turn answers with a
 * tool_result, and every figure those calls return rides out on AIResponse.toolFigures - from the
 * main loop, the failsafe call, the Agent SDK run and its retry, and through a repair of the draft -
 * because those figures are what the strict price check accepts for the turn.
 *
 * Mocked client and catalog - no DATABASE_URL, no API key.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BOX_TOTAL, BOX_UNIT, SUPREME_INPUT } from './price-fixtures.js';

const mockCreate = vi.fn();
const mockIsDevMode = vi.fn(() => false);
const mockAgentQuery = vi.fn();

vi.mock('../src/services/claude.js', () => ({
  CLAUDE_MODEL: 'claude-test-model',
  getClient: () => ({ messages: { create: mockCreate } }),
  isDevMode: mockIsDevMode,
  isFullCatalogEnabled: () => true,
  agentQuery: mockAgentQuery,
  logUsageLine: vi.fn(),
}));
vi.mock('../src/services/ragQuery.js', async () => {
  const { CATALOG } = await import('./price-fixtures.js');
  return {
    // Names only: enough for the judge to see a named product, no figures for the price checks.
    // One reference photo line, for the photo-url filter.
    getFullCatalogBlock: vi.fn(async () => 'Merek: Kertas Supreme\nProduk: Kertas Supreme 64 gsm cetak 1 warna\n[FOTO REFERENSI TERSEDIA] /uploads/ref/ks1.jpg\n  - Ukuran: 30 x 30 cm\n'),
    buildCatalogContext: vi.fn(async () => ''),
    getCatalogProducts: vi.fn(async () => CATALOG),
  };
});
const mockGetPoFormUrl = vi.fn(async () => 'https://forms.gle/REPLACE-ME');
vi.mock('../src/repositories/appSettings.js', () => ({
  getDefaultPromptSections: vi.fn(async () => [{ name: 'Identitas', content: 'CS Imperial Indopack' }]),
  getPoFormUrl: mockGetPoFormUrl,
  PO_FORM_PLACEHOLDER_URL: 'https://forms.gle/REPLACE-ME',
}));
vi.mock('../src/repositories/products.js', () => ({ listBrands: vi.fn(async () => []) }));
vi.mock('../src/repositories/conversations.js', () => ({
  getLastNMessages: vi.fn(),
  getConversationSummary: vi.fn(),
  updateConversationSummary: vi.fn(),
  countConversationMessages: vi.fn(),
  getMessagesForSummary: vi.fn(),
}));

const { callAIWithHistory } = await import('../src/services/aiLayer.js');

const BOX_INPUT = { product: 'Box Ivory 270 gsm cetak full color', size: '20 x 20 x 7,5 cm', qty: 10, unit: 'rim' };
const SUPREME_FIGURES = [165000, 1980000, 160000];
const BOX_FIGURES = [BOX_UNIT, BOX_TOTAL, 1500];
const REPLY = { message: 'Siap kak, ini rinciannya ya.', confidence: 'high', fit_basis: [], customer_type: 'unknown' };
// An earlier bot turn, so the first-reply greeting check stays out of these tests.
const HISTORY = [{ role: 'customer', content: 'halo' }, { role: 'bot', content: 'Halo kak, ada yang bisa kami bantu?' }];
const ASK = 'kertas supreme 30x30 12 rim sama box ivory 20x20x7,5 10 rim berapa kak?';

const priceCall = (id: string, input: Record<string, unknown>) => ({ type: 'tool_use', id, name: 'hitung_harga', input });
const toolTurn = (...blocks: unknown[]) => ({ content: blocks, stop_reason: 'tool_use', usage: {} });
const respondTurn = (input: Record<string, unknown> = REPLY) =>
  toolTurn({ type: 'tool_use', id: 'r1', name: 'respond_to_customer', input });
const textTurn = (text: string) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: {} });

type ToolResult = { type: string; tool_use_id: string; content: string; is_error?: boolean };
const toolResults = (req: { messages: { content: unknown }[] }): ToolResult[] =>
  (req.messages.at(-1)!.content as ToolResult[]).filter((b) => b.type === 'tool_result');

beforeEach(() => {
  mockCreate.mockReset();
  mockAgentQuery.mockReset();
  mockIsDevMode.mockReturnValue(false);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('API path', () => {
  it('answers two hitung_harga calls in one response and returns both items\' figures', async () => {
    mockCreate
      .mockResolvedValueOnce(toolTurn(priceCall('t1', SUPREME_INPUT), priceCall('t2', BOX_INPUT)))
      .mockResolvedValueOnce(respondTurn());

    const result = await callAIWithHistory(HISTORY, ASK);

    expect(result.message).toBe(REPLY.message);
    expect(result.toolFigures).toEqual(expect.arrayContaining([165000, 1980000, BOX_UNIT, BOX_TOTAL]));
    expect(result.priceCalls?.map((c) => c.outcome)).toEqual(['quote', 'quote']);
    const secondCallMessages = mockCreate.mock.calls[1]![0].messages;
    expect(secondCallMessages.at(-1).content.filter((b: { type: string }) => b.type === 'tool_result')).toHaveLength(2);
    const [supreme, box] = toolResults(mockCreate.mock.calls[1]![0]);
    expect(supreme).toMatchObject({ tool_use_id: 't1' });
    expect(supreme!.content).toMatch(/^HARGA:/);
    expect(supreme!.content).toContain('Rp 1.980.000');
    expect(box).toMatchObject({ tool_use_id: 't2' });
    expect(box!.content).toContain('Rp 9.000.000');
  });

  it('offers the tools in the cached order: web_search, resolve_link, hitung_harga, respond_to_customer', async () => {
    mockCreate.mockResolvedValueOnce(respondTurn());
    await callAIWithHistory(HISTORY, 'halo');
    expect(mockCreate.mock.calls[0]![0].tools.map((t: { name: string }) => t.name))
      .toEqual(['web_search', 'resolve_link', 'hitung_harga', 'respond_to_customer']);
  });

  // Review fix 3: the reply's photos are the catalog block's, never a url the model got elsewhere.
  it('sends only the reference photos this turn\'s catalog block printed', async () => {
    mockCreate.mockResolvedValueOnce(respondTurn({
      ...REPLY, image_urls: ['https://customer.example/foto.jpg', '/uploads/ref/ks1.jpg', '/uploads/ref/made-up.jpg'],
    }));
    expect((await callAIWithHistory(HISTORY, 'contoh desainnya ada kak?')).imageUrls).toEqual(['/uploads/ref/ks1.jpg']);
  });

  it('a turn with no price call has no tool figures', async () => {
    mockCreate.mockResolvedValueOnce(respondTurn());
    const result = await callAIWithHistory(HISTORY, 'halo');
    expect(result.toolFigures).toEqual([]);
    expect(result.priceToolRan).toBe(false);
    expect(result.priceCalls).toEqual([]);
  });

  // Final review I1: a call that priced nothing (here above the top tier) still ran - the strict check
  // then allows no price at all, instead of falling back to the catalog's tiers.
  it('says the price tool ran when its only call priced nothing', async () => {
    mockCreate
      .mockResolvedValueOnce(toolTurn(priceCall('t1', { ...SUPREME_INPUT, qty: 200 })))
      .mockResolvedValueOnce(respondTurn());
    const result = await callAIWithHistory(HISTORY, ASK);
    expect(toolResults(mockCreate.mock.calls[1]![0])[0]!.content).toMatch(/^DI_ATAS_TINGKAT_TERATAS:/);
    expect(result.toolFigures).toEqual([]);
    expect(result.priceToolRan).toBe(true);
    expect(result.priceCalls?.map((c) => c.outcome)).toEqual(['above_top_tier']);
  });

  it('says so when the only price call came from the failsafe', async () => {
    mockCreate
      .mockResolvedValueOnce(textTurn('Untuk 3 rim ...'))
      .mockResolvedValueOnce(toolTurn(priceCall('t1', { ...SUPREME_INPUT, qty: 3 })))
      .mockResolvedValueOnce(respondTurn());
    const result = await callAIWithHistory(HISTORY, ASK);
    expect(result).toMatchObject({ toolFigures: [], priceToolRan: true });
    expect(result.priceCalls?.map((c) => c.outcome)).toEqual(['below_minimum']);
  });

  it('a malformed call that never ran the tool is not a price call', async () => {
    mockCreate
      .mockResolvedValueOnce(toolTurn(priceCall('t1', { ...SUPREME_INPUT, qty: '12' })))
      .mockResolvedValueOnce(respondTurn());
    expect((await callAIWithHistory(HISTORY, ASK)).priceToolRan).toBe(false);
  });

  it('keeps the figures when the reply only comes from the failsafe call, which offers the same tools', async () => {
    mockCreate
      .mockResolvedValueOnce(toolTurn(priceCall('t1', BOX_INPUT)))
      .mockResolvedValueOnce(textTurn('Untuk box ivory 10 rim ...'))
      .mockResolvedValueOnce(respondTurn());

    const result = await callAIWithHistory(HISTORY, ASK);

    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(result.message).toBe(REPLY.message);
    expect(result.toolFigures).toEqual(BOX_FIGURES);
    expect(mockCreate.mock.calls[2]![0].tools).toBe(mockCreate.mock.calls[0]![0].tools);
  });

  it('a malformed call gets an error result the model can correct, and no figures', async () => {
    mockCreate
      .mockResolvedValueOnce(toolTurn(priceCall('t1', { ...SUPREME_INPUT, qty: '12' })))
      .mockResolvedValueOnce(respondTurn());

    const result = await callAIWithHistory(HISTORY, ASK);

    const [res] = toolResults(mockCreate.mock.calls[1]![0]);
    expect(res).toMatchObject({ tool_use_id: 't1', is_error: true });
    expect(res!.content).toContain('qty');
    expect(result.toolFigures).toEqual([]);
  });

  // A reply sent in the same response as its own price calls was written before their results came
  // back, so its figures are the model's arithmetic. It is not final: the prices run, and the reply
  // is asked for again with their results in view.
  const WRONG = { ...REPLY, message: '12 rim jadi Rp 2.220.000 ya kak.' };

  it('runs the price calls sent with a reply, and returns the reply resent after their results', async () => {
    mockCreate
      .mockResolvedValueOnce(toolTurn(priceCall('t1', SUPREME_INPUT), { type: 'tool_use', id: 'r1', name: 'respond_to_customer', input: WRONG }))
      .mockResolvedValueOnce(respondTurn());

    const result = await callAIWithHistory(HISTORY, ASK);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.message).toBe(REPLY.message);
    expect(result.toolFigures).toEqual(SUPREME_FIGURES);
    const [price, unsent] = toolResults(mockCreate.mock.calls[1]![0]);
    expect(price).toMatchObject({ tool_use_id: 't1' });
    expect(price!.content).toMatch(/^HARGA:/);
    expect(unsent).toMatchObject({ tool_use_id: 'r1' });
    expect(unsent!.content).toContain('BELUM terkirim');
    expect(unsent!.content).toContain('hitung_harga');
  });

  it('a reply sent with only a link lookup is still final', async () => {
    mockCreate.mockResolvedValueOnce(toolTurn(
      { type: 'tool_use', id: 'l1', name: 'resolve_link', input: { url: 'https://example.test' } },
      { type: 'tool_use', id: 'r1', name: 'respond_to_customer', input: REPLY },
    ));
    const result = await callAIWithHistory(HISTORY, 'halo');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result.message).toBe(REPLY.message);
  });

  it('the failsafe treats a reply sent with price calls the same way: one more ask, same tools', async () => {
    mockCreate
      .mockResolvedValueOnce(textTurn('Untuk 12 rim ...'))
      .mockResolvedValueOnce(toolTurn(priceCall('t1', SUPREME_INPUT), { type: 'tool_use', id: 'r1', name: 'respond_to_customer', input: WRONG }))
      .mockResolvedValueOnce(respondTurn());

    const result = await callAIWithHistory(HISTORY, ASK);

    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(result.message).toBe(REPLY.message);
    expect(result.toolFigures).toEqual(SUPREME_FIGURES);
    expect(mockCreate.mock.calls[2]![0].tools).toBe(mockCreate.mock.calls[0]![0].tools);
    const results = toolResults(mockCreate.mock.calls[2]![0]);
    expect(results.map((r) => r.tool_use_id)).toEqual(['t1', 'r1']);
    expect(results[1]!.content).toContain('BELUM terkirim');
  });

  it('the failsafe also gives a forced answer that only prices its results and one more ask', async () => {
    mockCreate
      .mockResolvedValueOnce(textTurn('Untuk 12 rim ...'))
      .mockResolvedValueOnce(toolTurn(priceCall('t1', SUPREME_INPUT)))
      .mockResolvedValueOnce(respondTurn());

    const result = await callAIWithHistory(HISTORY, ASK);

    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(result.message).toBe(REPLY.message);
    expect(result.toolFigures).toEqual(SUPREME_FIGURES);
  });

  it('the failsafe asks only once more: a second reply sent with price calls is not sent', async () => {
    const mixed = toolTurn(priceCall('t1', SUPREME_INPUT), { type: 'tool_use', id: 'r1', name: 'respond_to_customer', input: WRONG });
    mockCreate
      .mockResolvedValueOnce(textTurn('Untuk 12 rim ...'))
      .mockResolvedValueOnce(mixed)
      .mockResolvedValueOnce(mixed);

    const result = await callAIWithHistory(HISTORY, ASK);

    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ message: '', confidence: 'low', escalationReason: 'AI response failed structured output' });
  });

  it('a call to a tool the bot no longer has still gets a result, so the next request is valid', async () => {
    mockCreate
      .mockResolvedValueOnce(toolTurn({ type: 'tool_use', id: 't1', name: 'search_website', input: { query: 'box' } }))
      .mockResolvedValueOnce(respondTurn());

    await callAIWithHistory(HISTORY, ASK);

    expect(toolResults(mockCreate.mock.calls[1]![0])).toEqual([
      expect.objectContaining({ tool_use_id: 't1', is_error: true }),
    ]);
  });

  it('a repaired draft keeps the figures the tool returned earlier in the turn', async () => {
    // The repair re-asks with only the draft's text in view, so the model has no reason to call the
    // tool again - the figures it repeats are still this turn's.
    const judge = [
      { content: [{ type: 'text', text: '{"ok": false, "reason": "tidak cocok"}' }], usage: {} },
    ];
    const main = [
      toolTurn(priceCall('t1', SUPREME_INPUT)),
      respondTurn({ ...REPLY, message: 'Kertas Supreme 64 gsm cetak 1 warna ukuran 30 x 30 cm cocok untuk bungkus burger kak.' }),
      respondTurn(),
    ];
    // Judge requests carry the judge's own string system prompt; the reply calls send blocks.
    mockCreate.mockImplementation(async (req: { system: unknown }) => (typeof req.system === 'string' ? judge : main).shift());

    const result = await callAIWithHistory(HISTORY, ASK);

    expect(result.message).toBe(REPLY.message);
    expect(main).toHaveLength(0);
    expect(judge).toHaveLength(0);
    expect(result.toolFigures).toEqual(SUPREME_FIGURES);
    expect(result.priceToolRan).toBe(true);
    expect(result.priceCalls?.map((c) => c.outcome)).toEqual(['quote']);
  });
});

describe('Agent SDK path', () => {
  type Tool = { name: string; handler: (args: Record<string, unknown>, extra: unknown) => Promise<{ content: { text: string }[] }> };
  const call = (opts: { tools?: Tool[] }, name: string, input: Record<string, unknown>) =>
    opts.tools!.find((t) => t.name === name)!.handler(input, {});

  beforeEach(() => mockIsDevMode.mockReturnValue(true));

  it('registers resolve_link, hitung_harga, respond_to_customer in that order and returns every figure', async () => {
    const texts: string[] = [];
    let names: string[] = [];
    mockAgentQuery.mockImplementationOnce(async (opts: { tools: Tool[]; allowWebSearch?: boolean }) => {
      names = opts.tools.map((t) => t.name);
      texts.push((await call(opts, 'hitung_harga', SUPREME_INPUT)).content[0]!.text);
      texts.push((await call(opts, 'hitung_harga', BOX_INPUT)).content[0]!.text);
      await call(opts, 'respond_to_customer', REPLY);
      return '';
    });

    const result = await callAIWithHistory(HISTORY, ASK);

    expect(names).toEqual(['resolve_link', 'hitung_harga', 'respond_to_customer']);
    expect(mockAgentQuery.mock.calls[0]![0].allowWebSearch).toBe(true);
    expect(texts[0]).toMatch(/^HARGA:/);
    expect(texts[1]).toContain('Rp 9.000.000');
    expect(result.message).toBe(REPLY.message);
    expect(result.toolFigures).toEqual(expect.arrayContaining([...SUPREME_FIGURES, ...BOX_FIGURES]));
    expect(result.priceCalls?.map((c) => c.outcome)).toEqual(['quote', 'quote']);
  });

  it('keeps the first run\'s figures when the reply only comes from the retry', async () => {
    mockAgentQuery
      .mockImplementationOnce(async (opts: { tools: Tool[] }) => {
        await call(opts, 'hitung_harga', SUPREME_INPUT);
        return 'Untuk 12 rim ...';
      })
      .mockImplementationOnce(async (opts: { tools: Tool[] }) => {
        await call(opts, 'respond_to_customer', REPLY);
        return '';
      });

    const result = await callAIWithHistory(HISTORY, ASK);

    expect(mockAgentQuery).toHaveBeenCalledTimes(2);
    expect(result.toolFigures).toEqual(SUPREME_FIGURES);
    expect(result.priceToolRan).toBe(true);
  });

  it('says the price tool ran when its only call priced nothing, and not when there was none', async () => {
    mockAgentQuery
      .mockImplementationOnce(async (opts: { tools: Tool[] }) => {
        await call(opts, 'hitung_harga', { ...SUPREME_INPUT, qty: 3 });
        await call(opts, 'respond_to_customer', REPLY);
        return '';
      })
      .mockImplementationOnce(async (opts: { tools: Tool[] }) => {
        await call(opts, 'respond_to_customer', REPLY);
        return '';
      });
    expect(await callAIWithHistory(HISTORY, ASK)).toMatchObject({ toolFigures: [], priceToolRan: true });
    expect((await callAIWithHistory(HISTORY, 'halo')).priceToolRan).toBe(false);
  });
});

// Final review I4(a): the link check reads the customer's own turns and the PO form setting from the
// call itself.
describe('links in the reply', () => {
  const linkReply = (message: string) => respondTurn({ ...REPLY, message });

  it('sends back a link the customer sent this turn, with no repair', async () => {
    mockCreate.mockResolvedValueOnce(linkReply('Siap kak, sudah saya lihat https://instagram.com/ContohToko 😊'));
    const result = await callAIWithHistory(HISTORY, 'ini IG toko saya https://instagram.com/ContohToko');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result.message).toContain('https://instagram.com/ContohToko');
  });

  it('repairs a made-up PO link while the setting is the placeholder, and accepts the configured one', async () => {
    mockCreate
      .mockResolvedValueOnce(linkReply('Silakan isi form PO di https://forms.gle/Karangan ya kak'))
      .mockResolvedValueOnce(linkReply('Siap kak, form PO-nya saya kirim ya.'));
    const repaired = await callAIWithHistory(HISTORY, 'oke saya ambil');
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(mockCreate.mock.calls[1]![0].messages.at(-1))).toContain('https://forms.gle/Karangan');
    expect(repaired.message).toBe('Siap kak, form PO-nya saya kirim ya.');

    mockCreate.mockReset();
    mockGetPoFormUrl.mockResolvedValueOnce('https://forms.gle/ContohPO123');
    mockCreate.mockResolvedValueOnce(linkReply('Ini form PO-nya kak: https://forms.gle/ContohPO123'));
    expect((await callAIWithHistory(HISTORY, 'oke saya ambil')).message).toContain('https://forms.gle/ContohPO123');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('a placeholder setting written another way is not an allowed link either', async () => {
    mockGetPoFormUrl.mockResolvedValue('HTTPS://FORMS.GLE/REPLACE-ME/');
    try {
      mockCreate
        .mockResolvedValueOnce(linkReply('Silakan isi form PO di HTTPS://FORMS.GLE/REPLACE-ME/ ya kak'))
        .mockResolvedValueOnce(linkReply('Siap kak, form PO-nya saya kirim ya.'));
      const repaired = await callAIWithHistory(HISTORY, 'oke saya ambil');
      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(repaired.message).toBe('Siap kak, form PO-nya saya kirim ya.');
    } finally {
      mockGetPoFormUrl.mockImplementation(async () => 'https://forms.gle/REPLACE-ME');
    }
  });
});
