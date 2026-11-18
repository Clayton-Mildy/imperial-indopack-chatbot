// agentQuery (the USE_CLAUDE_CLI transport) on a spent subscription token. Claude Code reports it
// as a 'rejected' rate_limit_event, a synthetic assistant message, then a thrown error result - the
// event parks the token, and the call that found out is replayed on the next one, so the turn that
// hit the limit is not handed off (2026-10-12: token 1 spent until Oct 15, token 2 fine).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mockQuery, createSdkMcpServer: vi.fn() }));

const spent = (): AsyncIterable<unknown> => (async function* () {
  yield { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 1792018800, rateLimitType: 'seven_day' } };
  yield { type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: "You've hit your weekly limit" }] }, error: 'rate_limit' };
  throw new Error("Claude Code returned an error result: You've hit your weekly limit · resets Oct 15 at 6am");
})();
// The same refusal with no event at all (PC, 2026-10-14) - only the message says the token is spent.
const spentNoEvent = (): AsyncIterable<unknown> => (async function* () {
  yield { type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: "You've hit your session limit" }] }, error: 'rate_limit' };
  throw new Error("Claude Code returned an error result: You've hit your session limit · resets 3:10am (America/Los_Angeles)");
})();
// An account its organization has locked out of Claude Code (PC, 2026-10-14) - no reset will fix it.
const accessRefused = (): AsyncIterable<unknown> => (async function* () {
  throw new Error('Claude Code returned an error result: Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API key instead, or ask your admin to enable access');
})();
// A revoked token (PC, 2026-11-02): every turn went to it and was handed off with "Kita coba cek
// dengan tim dulu ya kak".
const revoked = (): AsyncIterable<unknown> => (async function* () {
  throw new Error('Claude Code returned an error result: Failed to authenticate. API Error: 401 OAuth access token has been revoked.');
})();
const answers = (text: string): AsyncIterable<unknown> => (async function* () {
  yield { type: 'assistant', message: { model: 'claude-haiku-4-5-20251001', content: [{ type: 'text', text }] } };
  yield { type: 'result', subtype: 'success', result: text, num_turns: 1, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } };
})();
const startsThenFails = (): AsyncIterable<unknown> => (async function* () {
  yield { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 1792018800, rateLimitType: 'five_hour' } };
  yield { type: 'assistant', message: { model: 'claude-haiku-4-5-20251001', content: [{ type: 'tool_use', name: 'respond_to_customer' }] } };
  throw new Error('Claude Code returned an error result: limit reached');
})();

async function load() {
  vi.resetModules();
  process.env.CLAUDE_CODE_OAUTH_TOKEN_1 = 'tok-one';
  process.env.CLAUDE_CODE_OAUTH_TOKEN_2 = 'tok-two';
  process.env.CLAUDE_USAGE_LOG_DIR = '/tmp/legacy-test-usage';
  return import('../src/services/claude.js');
}
const tokenOf = (call: number) => mockQuery.mock.calls[call]![0].options.env.CLAUDE_CODE_OAUTH_TOKEN;

describe('agentQuery on a spent subscription token', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('replays the call on the next token, and stays on it', async () => {
    const { agentQuery } = await load();
    mockQuery.mockReturnValueOnce(spent()).mockReturnValueOnce(answers('Jakarta')).mockReturnValueOnce(answers('Bandung'));

    expect(await agentQuery({ systemPrompt: 's', userContent: 'u' })).toBe('Jakarta');
    expect(await agentQuery({ systemPrompt: 's', userContent: 'u' })).toBe('Bandung');
    expect([tokenOf(0), tokenOf(1), tokenOf(2)]).toEqual(['tok-one', 'tok-two', 'tok-two']);
  });

  it('moves on from a token refused by the message alone, and stays off it', async () => {
    const { agentQuery } = await load();
    mockQuery.mockReturnValueOnce(spentNoEvent()).mockReturnValueOnce(answers('Jakarta')).mockReturnValueOnce(answers('Bandung'));

    expect(await agentQuery({ systemPrompt: 's', userContent: 'u' })).toBe('Jakarta');
    expect(await agentQuery({ systemPrompt: 's', userContent: 'u' })).toBe('Bandung');
    expect([tokenOf(0), tokenOf(1), tokenOf(2)]).toEqual(['tok-one', 'tok-two', 'tok-two']);
  });

  it('moves on from a token its organization has locked out, and stays off it', async () => {
    const { agentQuery } = await load();
    mockQuery.mockReturnValueOnce(accessRefused()).mockReturnValueOnce(answers('Jakarta')).mockReturnValueOnce(answers('Bandung'));

    expect(await agentQuery({ systemPrompt: 's', userContent: 'u' })).toBe('Jakarta');
    expect(await agentQuery({ systemPrompt: 's', userContent: 'u' })).toBe('Bandung');
    expect([tokenOf(0), tokenOf(1), tokenOf(2)]).toEqual(['tok-one', 'tok-two', 'tok-two']);
  });

  it('moves on from a revoked token, and stays off it', async () => {
    const { agentQuery } = await load();
    mockQuery.mockReturnValueOnce(revoked()).mockReturnValueOnce(answers('Jakarta')).mockReturnValueOnce(answers('Bandung'));

    expect(await agentQuery({ systemPrompt: 's', userContent: 'u' })).toBe('Jakarta');
    expect(await agentQuery({ systemPrompt: 's', userContent: 'u' })).toBe('Bandung');
    expect([tokenOf(0), tokenOf(1), tokenOf(2)]).toEqual(['tok-one', 'tok-two', 'tok-two']);
  });

  it('fails as before when every token is refused by message alone', async () => {
    const { agentQuery } = await load();
    mockQuery.mockReturnValueOnce(spentNoEvent()).mockReturnValueOnce(spentNoEvent());

    await expect(agentQuery({ systemPrompt: 's', userContent: 'u' })).rejects.toThrow('session limit');
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('leaves an unrelated failure alone - another account would fail the same way', async () => {
    const { agentQuery } = await load();
    mockQuery.mockReturnValueOnce((async function* () { throw new Error('Claude Code returned an error result: overloaded'); })());

    await expect(agentQuery({ systemPrompt: 's', userContent: 'u' })).rejects.toThrow('overloaded');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('does not replay once the model has started - a tool handler may already have run', async () => {
    const { agentQuery } = await load();
    mockQuery.mockReturnValueOnce(startsThenFails());

    await expect(agentQuery({ systemPrompt: 's', userContent: 'u' })).rejects.toThrow('limit reached');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  // Owner, 2026-11-03: with no token left the bot stays silent instead of handing every chat off.
  it('reports when no token can answer any more', async () => {
    const { agentQuery, claudeTokensExhausted } = await load();
    // spentNoEvent parks for 5 minutes from now (spent()'s reset is already in the past).
    mockQuery.mockReturnValueOnce(spentNoEvent()).mockReturnValueOnce(answers('Jakarta'));
    expect(claudeTokensExhausted()).toBe(false);
    await agentQuery({ systemPrompt: 's', userContent: 'u' });
    expect(claudeTokensExhausted()).toBe(false); // token 2 still answers

    // Token 2 revoked; the call is replayed on token 1, which is still spent.
    mockQuery.mockReturnValueOnce(revoked()).mockReturnValueOnce(spentNoEvent());
    await expect(agentQuery({ systemPrompt: 's', userContent: 'u' })).rejects.toThrow();
    expect(claudeTokensExhausted()).toBe(true);
  });

  it('fails as before when every token is spent', async () => {
    const { agentQuery } = await load();
    mockQuery.mockReturnValueOnce(spent()).mockReturnValueOnce(spent());

    await expect(agentQuery({ systemPrompt: 's', userContent: 'u' })).rejects.toThrow('weekly limit');
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});
