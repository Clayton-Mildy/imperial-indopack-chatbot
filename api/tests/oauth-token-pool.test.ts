/**
 * oauth-token-pool.test.ts
 * Several Claude OAuth tokens are used strictly by number: _1 until it is limited, then _2, and
 * back to _1 the moment _1's reset time has passed.
 */

import { describe, it, expect } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { OAuthTokenPool, readOAuthTokens, limitResetAt, type OAuthToken } from '../src/services/oauthTokenPool.js';

const T: OAuthToken[] = [
  { index: 1, value: 'tok-one' },
  { index: 2, value: 'tok-two' },
  { index: 3, value: 'tok-three' },
];

/** A fake API: answers per token from a script, records which token each call carried. */
function fakeApi(statusFor: (token: string) => number | { status: number; headers?: Record<string, string> }) {
  const seen: string[] = [];
  const fetch = (async (_url: unknown, init?: RequestInit) => {
    const token = new Headers(init?.headers).get('authorization')!.replace('Bearer ', '');
    seen.push(token);
    const r = statusFor(token);
    const { status, headers } = typeof r === 'number' ? { status: r, headers: {} } : r;
    const body = status === 200
      ? { id: 'msg_1', type: 'message', role: 'assistant', model: 'm', content: [{ type: 'text', text: token }],
          stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
      : { type: 'error', error: { type: status === 429 ? 'rate_limit_error' : 'authentication_error', message: 'x' } };
    return new Response(JSON.stringify(body), {
      status, headers: { 'content-type': 'application/json', 'x-should-retry': 'false', ...headers },
    });
  }) as typeof globalThis.fetch;
  return { fetch, seen };
}

describe('readOAuthTokens', () => {
  it('orders numbered tokens numerically, skips blanks, allows gaps', () => {
    expect(readOAuthTokens({
      CLAUDE_CODE_OAUTH_TOKEN_10: 'ten',
      CLAUDE_CODE_OAUTH_TOKEN_2: ' two ',
      CLAUDE_CODE_OAUTH_TOKEN_1: 'one',
      CLAUDE_CODE_OAUTH_TOKEN_3: '',
      CLAUDE_CODE_OAUTH_TOKEN: 'unnumbered is not part of the pool',
      ANTHROPIC_AUTH_TOKEN: 'legacy',
    })).toEqual([
      { index: 1, value: 'one' }, { index: 2, value: 'two' }, { index: 10, value: 'ten' },
    ]);
  });

  it('falls back to the legacy single ANTHROPIC_AUTH_TOKEN as token 1', () => {
    expect(readOAuthTokens({ ANTHROPIC_AUTH_TOKEN: 'legacy' })).toEqual([{ index: 1, value: 'legacy' }]);
    expect(readOAuthTokens({})).toEqual([]);
  });
});

describe('limitResetAt', () => {
  const now = 1_000_000_000_000;
  it('reads the unified reset (epoch seconds) and retry-after, taking the later', () => {
    const h = new Headers({ 'anthropic-ratelimit-unified-reset': String(now / 1000 + 3600), 'retry-after': '30' });
    expect(limitResetAt(h, now)).toBe(now + 3_600_000);
    expect(limitResetAt(new Headers({ 'retry-after': '30' }), now)).toBe(now + 30_000);
  });
  it('falls back to a short cooldown when the 429 carries no hint', () => {
    expect(limitResetAt(new Headers(), now)).toBe(now + 5 * 60_000);
  });
});

describe('OAuthTokenPool.fetch', () => {
  it('uses token 1 while it works', async () => {
    const pool = new OAuthTokenPool(T);
    const api = fakeApi(() => 200);
    await pool.fetch(api.fetch)('https://x', {});
    await pool.fetch(api.fetch)('https://x', {});
    expect(api.seen).toEqual(['tok-one', 'tok-one']);
  });

  it('fails over to the next token on 429, then returns to token 1 once it resets', async () => {
    let now = 0;
    const events: Record<string, unknown>[] = [];
    const pool = new OAuthTokenPool(T, () => now, (e) => events.push(e));
    let oneLimited = true;
    const api = fakeApi((t) => (t === 'tok-one' && oneLimited ? { status: 429, headers: { 'retry-after': '60' } } : 200));
    const f = pool.fetch(api.fetch);

    expect((await f('https://x', {})).status).toBe(200);
    expect(api.seen).toEqual(['tok-one', 'tok-two']);
    expect(events).toEqual([expect.objectContaining({ token: 1, reason: 'rate_limited', next: 2 })]);

    // Still inside token 1's window: straight to token 2, no wasted probe of token 1.
    now = 30_000;
    await f('https://x', {});
    expect(api.seen.slice(2)).toEqual(['tok-two']);

    // Window over: token 1 is first again.
    now = 60_000;
    oneLimited = false;
    await f('https://x', {});
    expect(api.seen.slice(3)).toEqual(['tok-one']);
  });

  it('skips a token whose credentials are rejected (401)', async () => {
    const pool = new OAuthTokenPool(T, () => 0);
    const api = fakeApi((t) => (t === 'tok-one' ? 401 : 200));
    expect((await pool.fetch(api.fetch)('https://x', {})).status).toBe(200);
    expect(api.seen).toEqual(['tok-one', 'tok-two']);
  });

  it('does not fail over on errors that are not about the token', async () => {
    const pool = new OAuthTokenPool(T);
    const api = fakeApi(() => 529);
    expect((await pool.fetch(api.fetch)('https://x', {})).status).toBe(529);
    expect(api.seen).toEqual(['tok-one']);
  });

  it('when every token is limited, returns the 429 and next tries the one that resets first', async () => {
    let now = 0;
    const pool = new OAuthTokenPool(T, () => now);
    const resets: Record<string, string> = { 'tok-one': '300', 'tok-two': '60', 'tok-three': '600' };
    const api = fakeApi((t) => ({ status: 429, headers: { 'retry-after': resets[t] } }));
    expect((await pool.fetch(api.fetch)('https://x', {})).status).toBe(429);
    expect(api.seen).toEqual(['tok-one', 'tok-two', 'tok-three']);

    now = 10_000;
    await pool.fetch(api.fetch)('https://x', {});
    expect(api.seen.slice(3)).toEqual(['tok-two']);
  });

  it('works through the real Anthropic client: one messages.create, transparent failover', async () => {
    const pool = new OAuthTokenPool(T, () => 0);
    const api = fakeApi((t) => (t === 'tok-one' ? 429 : 200));
    const client = new Anthropic({ authToken: 'tok-one', apiKey: null, fetch: pool.fetch(api.fetch), maxRetries: 0 });
    const msg = await client.messages.create({ model: 'm', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] });
    expect(msg.content[0]).toMatchObject({ text: 'tok-two' });
    expect(api.seen).toEqual(['tok-one', 'tok-two']);
  });
});
