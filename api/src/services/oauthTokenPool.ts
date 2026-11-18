// Several Claude OAuth tokens (sk-ant-oat01-...), used strictly in number order:
// CLAUDE_CODE_OAUTH_TOKEN_1 serves every request until it hits its usage limit, then _2 takes
// over, and so on. A limited token is only parked until its own reset time - the next request
// after that goes back to _1. That is the whole policy: the lowest-numbered token that is not
// parked. There is no "current token" to switch back, so there is no switch-back to get wrong.

type Fetch = typeof globalThis.fetch;

export interface OAuthToken {
  /** The N of CLAUDE_CODE_OAUTH_TOKEN_N, or 1 for the legacy single ANTHROPIC_AUTH_TOKEN. */
  index: number;
  value: string;
}

// When a 429 carries no reset hint at all. Re-probing token 1 costs one fast rejected request,
// so erring short only wastes a round trip; erring long keeps a recovered token idle.
export const DEFAULT_LIMIT_COOLDOWN_MS = 5 * 60_000;
// A 401 means a revoked or expired token, which no reset time will fix - but keep re-probing
// hourly rather than forever, so a token fixed in the console comes back without a restart.
export const AUTH_FAILURE_COOLDOWN_MS = 60 * 60_000;

/**
 * Reads CLAUDE_CODE_OAUTH_TOKEN_<N> in numeric order (gaps allowed: _1 and _3 is fine, and
 * _10 sorts after _9). With none set, the existing single ANTHROPIC_AUTH_TOKEN is token 1, so an
 * install whose .env predates numbering keeps working untouched.
 */
export function readOAuthTokens(env: NodeJS.ProcessEnv = process.env): OAuthToken[] {
  const numbered = Object.entries(env)
    .map(([key, value]) => ({ m: /^CLAUDE_CODE_OAUTH_TOKEN_(\d+)$/.exec(key), value: value?.trim() }))
    .filter((t): t is { m: RegExpExecArray; value: string } => t.m !== null && !!t.value)
    .map((t) => ({ index: Number(t.m[1]), value: t.value }))
    .sort((a, b) => a.index - b.index);
  if (numbered.length) return numbered;
  const legacy = env.ANTHROPIC_AUTH_TOKEN?.trim();
  return legacy ? [{ index: 1, value: legacy }] : [];
}

/**
 * When a rejected token may be tried again. Subscription tokens report their window's end as
 * anthropic-ratelimit-unified-reset (epoch seconds); retry-after (seconds) is the generic hint.
 * The later of the two wins - leaving early just earns another 429.
 */
export function limitResetAt(headers: Headers, now: number): number {
  const candidates: number[] = [];
  const unified = Number(headers.get('anthropic-ratelimit-unified-reset'));
  if (Number.isFinite(unified) && unified > 0) candidates.push(epochToMs(unified));
  const retryAfter = Number(headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) candidates.push(now + retryAfter * 1000);
  const latest = Math.max(...candidates);
  return latest > now ? latest : now + DEFAULT_LIMIT_COOLDOWN_MS;
}

// The Agent SDK's resetsAt has an undocumented unit (see claude.ts); headers use seconds.
// Anything below 1e12 cannot be a millisecond epoch later than 2001.
export function epochToMs(value: number): number {
  return value < 1e12 ? value * 1000 : value;
}

export class OAuthTokenPool {
  private readonly parkedUntil = new Map<number, number>();

  constructor(
    readonly tokens: OAuthToken[],
    private readonly now: () => number = Date.now,
    private readonly log: (event: Record<string, unknown>) => void = () => {},
  ) {}

  /** Tokens to try for one request, best first: every unparked token in number order. When all
   *  are parked, the one that frees up soonest - the request still has to go somewhere. */
  candidates(): OAuthToken[] {
    const now = this.now();
    const free = this.tokens.filter((t) => (this.parkedUntil.get(t.index) ?? 0) <= now);
    if (free.length) return free;
    const soonest = [...this.tokens].sort(
      (a, b) => this.parkedUntil.get(a.index)! - this.parkedUntil.get(b.index)!,
    )[0];
    return soonest ? [soonest] : [];
  }

  isParked(token: OAuthToken): boolean {
    return (this.parkedUntil.get(token.index) ?? 0) > this.now();
  }

  park(token: OAuthToken, until: number, reason: string): void {
    this.parkedUntil.set(token.index, until);
    const next = this.candidates()[0];
    this.log({
      token: token.index,
      reason,
      until: new Date(until).toLocaleString('sv-SE'),
      next: next && next.index !== token.index ? next.index : null,
    });
  }

  /**
   * A fetch for the Anthropic client that sends each request with the best token and, when that
   * token is rate-limited (429) or rejected (401), parks it and replays the same request with the
   * next one. Only the response of the last token tried reaches the SDK, whose own retry policy
   * then applies as usual. Status codes that say nothing about the token (overloaded, 5xx, 400)
   * are returned untouched: another account would fail the same way.
   */
  fetch(baseFetch: Fetch = globalThis.fetch): Fetch {
    return async (input, init) => {
      const candidates = this.candidates();
      let response: Response | undefined;
      for (const [i, token] of candidates.entries()) {
        const headers = new Headers(init?.headers);
        headers.set('authorization', `Bearer ${token.value}`);
        response = await baseFetch(input, { ...init, headers });
        if (response.status !== 429 && response.status !== 401) return response;
        const until = response.status === 429
          ? limitResetAt(response.headers, this.now())
          : this.now() + AUTH_FAILURE_COOLDOWN_MS;
        this.park(token, until, response.status === 429 ? 'rate_limited' : 'unauthorized');
        if (i < candidates.length - 1) await response.body?.cancel();
      }
      return response!;
    };
  }
}
