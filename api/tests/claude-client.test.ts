/**
 * claude-client.test.ts
 * getClient() must cap the SDK's defaults (10min timeout x 2 retries could block a
 * conversation ~30min on a hung call) — 90s timeout, 1 retry, env-overridable.
 */

import { describe, it, expect, vi } from 'vitest';

const constructorArgs: unknown[] = [];
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    constructor(opts: unknown) { constructorArgs.push(opts); }
  },
}));
vi.mock('../src/config.js', () => ({
  getConfig: () => ({ ANTHROPIC_API_KEY: 'sk-test-key' }),
}));

describe('getClient', () => {
  it('passes the 90s timeout to the SDK (retries stay at the SDK default)', async () => {
    delete process.env.ANTHROPIC_TIMEOUT_MS;
    const { getClient } = await import('../src/services/claude.js');

    getClient();
    getClient(); // memoized — one construction

    expect(constructorArgs).toHaveLength(1);
    expect(constructorArgs[0]).toMatchObject({
      apiKey: 'sk-test-key',
      timeout: 90_000,
    });
    expect(constructorArgs[0]).not.toHaveProperty('maxRetries');
  });
});
