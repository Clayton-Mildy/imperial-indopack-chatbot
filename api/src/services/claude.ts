import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { query, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { SdkMcpToolDefinition, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { getConfig } from '../config.js';
import { OAuthTokenPool, readOAuthTokens, epochToMs, DEFAULT_LIMIT_COOLDOWN_MS, AUTH_FAILURE_COOLDOWN_MS, type OAuthToken } from './oauthTokenPool.js';

export const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

// Usage lines get their own monthly file as well as stdout. The NSSM stdout log interleaves
// them with every other console line and rotates by size (10MB, install.ps1), which discards
// exactly the history you want when reconciling a month of spend. Default resolves to
// <install dir>\logs\claude-usage: the service's working directory is <install dir>\api
// (install.ps1 sets AppDirectory), so '..' lands in the same logs folder NSSM already uses.
function usageLogDir(): string {
  return process.env.CLAUDE_USAGE_LOG_DIR ?? path.join(process.cwd(), '..', 'logs', 'claude-usage');
}

// Local time, never UTC: these are read next to WhatsApp timestamps, and a UTC-vs-WIB mismatch
// is precisely what made 04:42 in the Console look unrelated to an 11:42 chat. 'sv-SE' is the
// shortest stdlib route to "YYYY-MM-DD HH:mm:ss"; the month slice makes rotation a side effect
// of the filename, so there is no rotation code to get wrong.
export function usageLogPath(date = new Date(), dir = usageLogDir()): string {
  return path.join(dir, `claude-usage-${date.toLocaleString('sv-SE').slice(0, 7)}.log`);
}

/** Single sink for both transports' usage telemetry - API path and Agent SDK path alike. */
export function logUsageLine(tag: string, payload: Record<string, unknown>): void {
  const line = `${new Date().toLocaleString('sv-SE')} ${tag} ${JSON.stringify(payload)}`;
  console.log(line);
  try {
    const file = usageLogPath();
    mkdirSync(path.dirname(file), { recursive: true });
    // ponytail: sync append, ~10 short lines per customer message. Move to a write stream only
    // if volume ever makes the blocking write measurable.
    appendFileSync(file, line + '\n');
  } catch (err) {
    // A telemetry failure must never cost a customer their reply.
    console.error('[claude] usage log write failed', err);
  }
}

// Dev mode (USE_CLAUDE_CLI=true in .env): every Claude call goes through the
// Claude Agent SDK, which authenticates with the local Claude Code subscription
// login instead of ANTHROPIC_API_KEY. Prod uses the Anthropic API directly.
export function isDevMode(): boolean {
  return process.env.USE_CLAUDE_CLI === 'true';
}

// Full-catalog mode (default on): the whole catalog rides in a cached system-prompt prefix
// instead of a per-query RAG slice. FULL_CATALOG=0 (or false/off) is the instant rollback to
// the legacy top-20 RAG path — an .env edit + service restart, no redeploy. Accept every
// plausible "off" spelling: an operator mid-incident must not be foiled by 0-vs-false.
export function isFullCatalogEnabled(): boolean {
  const v = (process.env.FULL_CATALOG ?? '').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(v);
}

// oauth-2025-04-20 is what makes the API accept a Bearer OAuth token at all;
// extended-cache-ttl-2025-04-11 is required by the 1h cache_control TTL aiLayer.ts:521 sets, and
// setting defaultHeaders here would otherwise drop whatever the SDK adds for it.
const OAUTH_BETAS = 'oauth-2025-04-20,extended-cache-ttl-2025-04-11';

let _client: Anthropic | null = null;
let _tokenPool: OAuthTokenPool | null = null;

/** CLAUDE_CODE_OAUTH_TOKEN_1.._N (or the legacy single ANTHROPIC_AUTH_TOKEN), shared by both
 *  transports so a limit hit on one is respected by the other. Failovers land in the usage log. */
export function getTokenPool(): OAuthTokenPool {
  _tokenPool ??= new OAuthTokenPool(readOAuthTokens(), Date.now, (event) =>
    logUsageLine('[claude] oauth token parked', event));
  return _tokenPool;
}

/**
 * Every subscription token is refused right now - spent, revoked or locked out - so no AI call can
 * succeed until one resets or is replaced. False when the bot runs on an API key (no tokens at all).
 * messageRouter stays silent then (owner, 2026-11-03) instead of sending its hand-off lines.
 */
export function claudeTokensExhausted(): boolean {
  const pool = getTokenPool();
  return pool.tokens.length > 0 && pool.tokens.every((t) => pool.isParked(t));
}

export function getClient(): Anthropic {
  // SDK default timeout is 10min — a hung call could block a conversation ~30min with
  // retries. 90s sits comfortably above the ~30s normal turn (messageRouter's baseline);
  // failures surface to messageRouter, which escalates instead of leaving silence.
  // Retries stay at the SDK default (2) so a transient 529 still becomes an answer.
  // The OAuth tokens are Claude OAuth access tokens (sk-ant-oat01-...), the credential the QA
  // harness authenticates with. The SDK reads ANTHROPIC_AUTH_TOKEN on its own, but only when no
  // apiKey is passed - and this call always passed one, so an OAuth-only machine fell back to
  // whatever placeholder sat in .env and every request 401'd. Verified working with the full
  // catalog and prompt caching (47,876-token prefix written on call 1, read back on call 2), so
  // this is the production transport, not a second code path: same client, same caching,
  // different credential. With several tokens, the pool's fetch picks one per request and fails
  // over on a 429/401; the authToken given here is only the header it overwrites.
  const pool = getTokenPool();
  _client ??= new Anthropic({
    ...(pool.tokens.length
      ? {
          authToken: pool.tokens[0].value,
          apiKey: null,
          defaultHeaders: { 'anthropic-beta': OAUTH_BETAS },
          fetch: pool.fetch(),
        }
      : { apiKey: getConfig().ANTHROPIC_API_KEY }),
    timeout: Number(process.env.ANTHROPIC_TIMEOUT_MS ?? 90_000),
  });
  return _client;
}

export type UserContent = string | Anthropic.MessageParam['content'];

// "You've hit your session limit · resets 3:10am", "... weekly limit ...", "... limit for Sonnet".
const LIMIT_HIT_RE = /hit your [\w ]*limit/i;
// A token whose account cannot use Claude Code at all - no reset time will fix it. Live 2026-10-14:
// "Your organization has disabled Claude subscription access for Claude Code". Live 2026-11-02:
// "Failed to authenticate. API Error: 401 OAuth access token has been revoked" matched nothing here,
// so the dead token kept every turn and each one was handed off while the other tokens sat unused.
// Tested by hand 2026-11-03, dead tokens also answer "401 OAuth access token is invalid".
const ACCESS_REFUSED_RE = /organization has disabled|invalid api key|failed to authenticate|\b401\b|token has (?:been revoked|expired)/i;

// The in-process MCP server that carries the dev-mode tools. Claude Code names each of its tools
// mcp__<server>__<tool>, and only names in allowedTools may run - so both come from here.
export const MCP_SERVER = 'imperial';
export const mcpToolName = (tool: string): string => `mcp__${MCP_SERVER}__${tool}`;

// Dev-mode transport. Runs one turn (plus tool-use loop) through the Agent SDK
// with the given system prompt and optional in-process tools, and returns the
// final assistant text. Structured output is captured by the caller inside a
// tool handler closure (see aiLayer's respond_to_customer tool).
export async function agentQuery(opts: {
  systemPrompt: string;
  userContent: UserContent;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools?: SdkMcpToolDefinition<any>[];
  maxTurns?: number;
  // Enable the Agent SDK's built-in general web search (dev-mode parity with the
  // prod API's web_search server tool). Scoped by the system prompt.
  allowWebSearch?: boolean;
  // For short classification calls (photo keywords, photo comparison). The API route never
  // thinks on them; Claude Code thinks by default, which took them past the photo comparison's
  // 30 s budget on every production photo turn (2026-10-09..12) - silently, so every photo was
  // answered without its comparison.
  noThinking?: boolean;
  // Claude Code model id or alias; CLAUDE_MODEL when absent.
  model?: string;
}, replays = 0): Promise<string> {
  // Strip the (dummy) API key so the Agent SDK uses the Claude Code login.
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  // With OAuth tokens configured, hand Claude Code the best one instead of the machine's login.
  // A turn cannot be replayed here (tool handlers have already run), so a rejection only parks
  // the token: this turn fails as it would have, and the next one uses the next token.
  const token = getTokenPool().candidates()[0];
  if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token.value;

  const prompt =
    typeof opts.userContent === 'string'
      ? opts.userContent
      : (async function* (): AsyncIterable<SDKUserMessage> {
          yield {
            type: 'user',
            message: { role: 'user', content: opts.userContent },
            parent_tool_use_id: null,
            session_id: '',
          } as SDKUserMessage;
        })();

  const q = query({
    prompt,
    options: {
      model: opts.model ?? CLAUDE_MODEL,
      systemPrompt: opts.systemPrompt,
      env,
      settingSources: [],
      tools: [], // no SDK-defined tools beyond the in-process ones below
      // NOTE: thinking is deliberately left at the harness default. Disabling it (tried
      // 2026-08-17 for latency — the judge was thinking 8.5K tokens/~89s per reply) made the
      // judge double-reject ordinary product answers, so customers got the still-checking ack
      // instead of an answer. Dev-mode latency is the test bench's cost, not production's:
      // the prod API path has no harness and no thinking to begin with.
      maxTurns: opts.maxTurns ?? 8,
      ...(opts.noThinking ? { thinking: { type: 'disabled' as const } } : {}),
      ...(opts.tools?.length
        ? {
            mcpServers: {
              [MCP_SERVER]: createSdkMcpServer({ name: MCP_SERVER, version: '1.0.0', tools: opts.tools }),
            },
          }
        : {}),
      ...((opts.tools?.length || opts.allowWebSearch)
        ? {
            allowedTools: [
              ...(opts.tools?.map((t) => mcpToolName(t.name)) ?? []),
              // Deliberately NOT 'WebFetch': in this headless harness the built-in fetch tool
              // is unreachable and the model fabricates calls ("Senayan City", 2026-08-20).
              // Customer links go through our own resolve_link custom tool instead.
              ...(opts.allowWebSearch ? ['WebSearch'] : []),
            ],
          }
        : {}),
    },
  });

  let result = '';
  let started = false;
  try {
    result = await drainAgentQuery(q, token, () => { started = true; });
  } catch (err) {
    // A spent subscription (weekly / 5-hour limit) parks its token through the 'rejected'
    // rate_limit_event below, but the call that found out still failed - and on a photo turn that
    // was the customer's whole answer, handed off. When the pool now prefers another token and the
    // model never started (only Claude Code's synthetic limit message, so no tool handler can have
    // run), replay the call on it.
    // Once every token is spent the pool offers whichever resets first, so without the cap two
    // spent tokens would hand the call back and forth forever.
    const pool = getTokenPool();
    // Claude Code can also refuse a token with a message alone, no 'rejected' event. On the PC
    // 2026-10-14 token 1 ran out, token 2 answered "Your organization has disabled Claude
    // subscription access", and every turn went to token 2 and was handed off while 3 and 4 sat
    // unused. Neither message carries a machine-readable reset, so park for the matching cooldown.
    const refusal = err instanceof Error ? err.message : String(err);
    if (token && !started && !pool.isParked(token)) {
      if (LIMIT_HIT_RE.test(refusal)) pool.park(token, Date.now() + DEFAULT_LIMIT_COOLDOWN_MS, 'rate_limited');
      else if (ACCESS_REFUSED_RE.test(refusal)) pool.park(token, Date.now() + AUTH_FAILURE_COOLDOWN_MS, 'unauthorized');
    }
    const next = pool.candidates()[0];
    if (!token || started || !next || next.index === token.index || replays >= pool.tokens.length - 1) throw err;
    console.warn(`[claude] token ${token.index} ${LIMIT_HIT_RE.test(refusal) ? 'hit its limit' : 'was refused'} mid-call - replaying on token ${next.index}`);
    return agentQuery(opts, replays + 1);
  }
  return result;
}

async function drainAgentQuery(
  q: AsyncIterable<SDKMessage>,
  token: OAuthToken | undefined,
  onStarted: () => void,
): Promise<string> {
  let result = '';
  for await (const msg of q) {
    // Claude Code reports a spent limit as an assistant message from model '<synthetic>'.
    if (msg.type === 'assistant' && msg.message.model !== '<synthetic>') onStarted();
    // Subscription-path telemetry. aiLayer's logUsage() covers the API path only, so without
    // this the Agent SDK path is unmetered - and it is the path with no Console usage page
    // behind it, because subscription traffic is never billed to the API org.
    if (msg.type === 'rate_limit_event') {
      const rl = msg.rate_limit_info;
      // resetsAt's unit is undocumented - log it raw rather than render a wrong timestamp.
      logUsageLine('[claude] ratelimit', {
        status: rl.status, type: rl.rateLimitType, utilization: rl.utilization, resets_at: rl.resetsAt,
        ...(token ? { token: token.index } : {}),
      });
      if (token && rl.status === 'rejected') {
        getTokenPool().park(token, rl.resetsAt ? epochToMs(rl.resetsAt) : Date.now() + DEFAULT_LIMIT_COOLDOWN_MS, 'rate_limited');
      }
    }
    if (msg.type === 'result') {
      // Both result variants (success and error) carry usage: an aborted turn still spends
      // quota, so log before branching on subtype. total_cost_usd is what the turn WOULD have
      // cost on the API - on a subscription nothing is charged, it is a comparison number.
      logUsageLine('[claude] usage agent', {
        in: msg.usage.input_tokens,
        out: msg.usage.output_tokens,
        cache_write: msg.usage.cache_creation_input_tokens,
        cache_read: msg.usage.cache_read_input_tokens,
        turns: msg.num_turns,
        would_cost_usd: msg.total_cost_usd,
        subtype: msg.subtype,
      });
      result = msg.subtype === 'success' ? msg.result : '';
    }
  }
  return result;
}
