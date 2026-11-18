/**
 * ai-plain-text-reply.test.ts
 * Free text from the model is never a customer reply. Live 2026-10-05 a customer who typed
 * "baik kak, saya tunggu ya kak. terima kasih" was sent the model's own analysis of the chat
 * ("Pesan customer ... adalah acknowledgment dan closing statement ... Tidak ada balasan tambahan")
 * because the failsafe call returned text instead of a respond_to_customer call and that text was
 * shipped as a high-confidence reply.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
vi.mock('../src/services/ragQuery.js', () => ({
  getFullCatalogBlock: vi.fn(async () => 'Produk: Test Product'),
  buildCatalogContext: vi.fn(async () => ''),
}));
vi.mock('../src/repositories/appSettings.js', () => ({
  getDefaultPromptSections: vi.fn(async () => [{ name: 'Identitas', content: 'CS Legacy' }]),
}));
vi.mock('../src/repositories/products.js', () => ({ listBrands: vi.fn(async () => []) }));
vi.mock('../src/repositories/conversations.js', () => ({
  getLastNMessages: vi.fn(),
  getConversationSummary: vi.fn(),
  updateConversationSummary: vi.fn(),
  countConversationMessages: vi.fn(),
  getMessagesForSummary: vi.fn(),
}));
vi.mock('../src/services/legacySearch.js', () => ({ searchLegacyWebsite: vi.fn() }));

const { callAIWithHistory, extractFromToolInput } = await import('../src/services/aiLayer.js');

const ANALYSIS =
  'Saat ini customer telah mengkonfirmasi bahwa mereka akan menunggu.\n\n' +
  'Pesan customer adalah acknowledgment dan closing statement.\n\n' +
  '**Tidak ada balasan tambahan yang diperlukan pada saat ini.**';

const textTurn = (text: string) => ({
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
  usage: {},
});

beforeEach(() => {
  mockCreate.mockReset();
  mockAgentQuery.mockReset();
  mockIsDevMode.mockReturnValue(false);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('free text instead of respond_to_customer', () => {
  it('API path: the failsafe call answering in text is dropped, not sent', async () => {
    mockCreate.mockResolvedValue(textTurn(ANALYSIS));

    const r = await callAIWithHistory(
      [{ role: 'bot', content: 'Ini juga kami cek dengan tim dulu ya kak' }],
      'baik kak, saya tunggu ya kak. terima kasih',
    );

    expect(mockCreate).toHaveBeenCalledTimes(2); // main call, then the failsafe
    expect(r.message).toBe('');
    expect(r.confidence).toBe('low');
    expect(r.escalationReason).toBe('AI response failed structured output');
  });

  it('API path: a real respond_to_customer call in the failsafe is still used', async () => {
    mockCreate
      .mockResolvedValueOnce(textTurn('Siap kak'))
      .mockResolvedValueOnce({
        content: [{
          type: 'tool_use', id: 't1', name: 'respond_to_customer',
          input: { message: 'Sama-sama kak 🙏', confidence: 'high', fit_basis: [], customer_type: 'unknown' },
        }],
        stop_reason: 'tool_use',
        usage: {},
      });

    const r = await callAIWithHistory([], 'terima kasih');

    expect(r.message).toBe('Sama-sama kak 🙏');
    expect(r.confidence).toBe('high');
  });

  it('Agent SDK path: text without a tool call is dropped too, after one more ask', async () => {
    mockIsDevMode.mockReturnValue(true);
    mockAgentQuery.mockResolvedValue(ANALYSIS);

    const r = await callAIWithHistory([], 'baik kak, saya tunggu ya kak. terima kasih');

    expect(mockAgentQuery).toHaveBeenCalledTimes(2);
    expect(r.message).toBe('');
    expect(r.confidence).toBe('low');
  });
});

// The Agent SDK route had no failsafe call, so on the production PC (which ran on it) every answer
// written as text instead of through respond_to_customer became a hand-off. Live 2026-10-09: a padlock
// order waited 7 minutes, then got "Kita coba cek dengan tim dulu" - "AI response failed structured output".
describe('Agent SDK path: the failsafe the API path always had', () => {
  type Tool = { name: string; handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown> };
  const callRespond = (opts: { tools?: Tool[] }, input: Record<string, unknown>) =>
    opts.tools!.find((t) => t.name === 'respond_to_customer')!.handler(input, {});
  const REPLY = { message: 'Mohon maaf kak, untuk gembok putih di kami adanya ukuran 40, 50, dan 60mm ya kak.', confidence: 'high', customer_type: 'end_user' };

  beforeEach(() => mockIsDevMode.mockReturnValue(true));

  it('asks once more, with only the respond tool and the draft in view, and sends what comes back', async () => {
    mockAgentQuery
      .mockResolvedValueOnce('Mohon maaf kak, untuk gembok putih di kami adanya ukuran 40, 50, dan 60mm ya kak.')
      .mockImplementationOnce(async (opts) => { await callRespond(opts, REPLY); return ''; });

    const r = await callAIWithHistory([], 'yang leher panjang 2, yang pendek 2');

    expect(r).toMatchObject({ message: REPLY.message, confidence: 'high' });
    const retry = mockAgentQuery.mock.calls[1]![0];
    expect(retry.tools.map((t: Tool) => t.name)).toEqual(['respond_to_customer']);
    expect(retry.maxTurns).toBe(2);
    expect(retry.allowWebSearch).toBeFalsy();
    expect(JSON.stringify(retry.userContent)).toContain('BELUM terkirim');
    expect(JSON.stringify(retry.userContent)).toContain('panggil tool respond_to_customer');
  });

  it('gives a run that ran out of turns the same second chance', async () => {
    mockAgentQuery
      .mockRejectedValueOnce(new Error('Claude Code returned an error result: Reached maximum number of turns (8)'))
      .mockImplementationOnce(async (opts) => { await callRespond(opts, REPLY); return ''; });

    const r = await callAIWithHistory([], 'yang leher panjang 2, yang pendek 2');
    expect(r.message).toBe(REPLY.message);
  });

  it('still fails the turn - as before - when the second ask fails too', async () => {
    mockAgentQuery
      .mockRejectedValueOnce(new Error('Reached maximum number of turns (8)'))
      .mockRejectedValueOnce(new Error('again'));
    await expect(callAIWithHistory([], 'halo')).rejects.toThrow('Reached maximum number of turns (8)');
  });

  it('does not ask again when the first run did call the tool', async () => {
    mockAgentQuery.mockImplementationOnce(async (opts) => { await callRespond(opts, REPLY); return ''; });
    await callAIWithHistory([], 'halo');
    expect(mockAgentQuery).toHaveBeenCalledTimes(1);
  });
});

// The model - not a keyword list - decides that "baik kak, saya tunggu ya kak. terima kasih" needs no
// answer, by calling the tool with no_reply. That is the valid way to say "nothing", so it has no
// reason to write its reasoning as text.
describe('total_for_team', () => {
  it('is read off the tool call, and only as true', () => {
    const base = { message: 'Engsel 4": Rp 42.000/Set', confidence: 'high', fit_basis: [], customer_type: 'project' };
    expect(extractFromToolInput({ ...base, total_for_team: true }).totalForTeam).toBe(true);
    expect(extractFromToolInput({ ...base, total_for_team: 'ya' }).totalForTeam).toBeUndefined();
    expect(extractFromToolInput(base).totalForTeam).toBeUndefined();
  });
});

describe('no_reply', () => {
  const input = (over: Record<string, unknown>) =>
    ({ message: '', confidence: 'high', fit_basis: [], customer_type: 'project', ...over });

  it('a bare no_reply call is a "send nothing" response', () => {
    const r = extractFromToolInput(input({ no_reply: true }));
    expect(r.noReply).toBe(true);
    expect(r.message).toBe('');
    expect(r.confidence).toBe('high');
  });

  it('is ignored when there is text (the text is a reply) or when it is a hand-off', () => {
    expect(extractFromToolInput(input({ no_reply: true, message: 'Siap kak' })).noReply).toBeUndefined();
    expect(extractFromToolInput(input({ no_reply: true, confidence: 'low', escalation_reason: 'x' })).noReply).toBeUndefined();
    expect(extractFromToolInput(input({})).noReply).toBeUndefined();
  });

  it('API path: a failsafe that answers with no_reply gives a no-reply response, not an escalation', async () => {
    mockCreate
      .mockResolvedValueOnce(textTurn(ANALYSIS))
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 't1', name: 'respond_to_customer', input: input({ no_reply: true }) }],
        stop_reason: 'tool_use',
        usage: {},
      });

    const r = await callAIWithHistory(
      [{ role: 'bot', content: 'Ini juga kami cek dengan tim dulu ya kak' }],
      'baik kak, saya tunggu ya kak. terima kasih',
    );

    expect(r.noReply).toBe(true);
    expect(r.confidence).toBe('high');
    expect(r.message).toBe('');
  });

  it('the tool offers no_reply, and the failsafe instruction mentions it', async () => {
    mockCreate.mockResolvedValue(textTurn(ANALYSIS));
    await callAIWithHistory([], 'terima kasih');

    const [mainReq, failsafeReq] = mockCreate.mock.calls.map(([r]) => r);
    const respond = mainReq.tools.find((t: { name: string }) => t.name === 'respond_to_customer');
    expect(respond.input_schema.properties.no_reply.type).toBe('boolean');
    expect(JSON.stringify(failsafeReq.messages.at(-1))).toContain('no_reply');
  });
});
