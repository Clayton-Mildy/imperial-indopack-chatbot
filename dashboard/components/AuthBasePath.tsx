"use client";

import { SessionProvider } from "next-auth/react";

/**
 * Teaches next-auth's CLIENT helpers where its routes live.
 *
 * The dashboard runs under a Next.js basePath (`/app`) so it can ride through the API's single
 * tunnel. Next applies that prefix to links and assets, but NOT to a plain `fetch` - and
 * `signIn()`/`signOut()` are plain fetches. next-auth derives their prefix from
 * `process.env.NEXTAUTH_URL`, which is server-only, so in the browser it falls back to
 * `/api/auth` and every login POST 404s under the prefix.
 *
 * `basePath` on SessionProvider is the only supported way to override it. Setting it in
 * AUTH_URL instead does NOT work and breaks the server too: Next strips the basePath before the
 * route handler sees the request, so next-auth compares `/api/auth/csrf` against its expected
 * `/app/api/auth` and throws UnknownAction.
 *
 * Refetching is off because nothing here calls useSession - every page reads the session
 * server-side via auth(). Without this the provider would add a /session request to every page
 * load, which nothing here needs.
 */
export function AuthBasePath({ children }: { children: React.ReactNode }) {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/app";
  return (
    <SessionProvider
      basePath={`${basePath}/api/auth`}
      refetchInterval={0}
      refetchOnWindowFocus={false}
    >
      {children}
    </SessionProvider>
  );
}
