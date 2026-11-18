import { describe, it, expect } from 'vitest';
import { forwardOriginalHost } from '../src/app.js';

// Next 16 compares Origin against x-forwarded-host and aborts the Server Action when they
// disagree. reply-from has already rewritten `host` to the upstream by the time this runs, so
// the original host has to come from the incoming request, not from the outgoing headers.
describe('forwardOriginalHost', () => {
  it('carries the public hostname past reply-from overwriting Host with the upstream', () => {
    const out = forwardOriginalHost(
      { headers: { host: 'dashboard.example.co.id', origin: 'https://dashboard.example.co.id' } },
      { host: '127.0.0.1:40050' }
    );
    expect(out['x-forwarded-host']).toBe('dashboard.example.co.id');
    // The upstream still has to see the upstream in Host, or it answers for the wrong vhost.
    expect(out['host']).toBe('127.0.0.1:40050');
  });

  it('leaves the headers alone when there is no Host to forward', () => {
    const headers = { host: '127.0.0.1:40050' };
    expect(forwardOriginalHost({ headers: {} }, headers)).toBe(headers);
  });

  it('overrides an x-forwarded-host the client supplied, rather than trusting it', () => {
    const out = forwardOriginalHost(
      { headers: { host: 'dashboard.example.co.id' } },
      { host: '127.0.0.1:40050', 'x-forwarded-host': 'attacker.example' }
    );
    expect(out['x-forwarded-host']).toBe('dashboard.example.co.id');
  });
});
