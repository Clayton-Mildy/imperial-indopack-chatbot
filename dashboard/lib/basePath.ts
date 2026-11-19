// The dashboard is served under a basePath (/app) so it can ride through the API's single
// Cloudflare tunnel - see the @fastify/http-proxy registration in api/src/app.ts.
//
// Next applies that prefix to <Link> and router.push, but NOT to a raw <a href> or fetch().
// A bare "/api/leads-export" therefore resolves against the origin root, where only the
// Fastify API is listening, and 404s. Any client-side URL built by hand needs this.
//
// Client-safe: NEXT_PUBLIC_* is inlined at build time.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/app";
