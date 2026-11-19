import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

const AGENT_BLOCKED = ["/admin", "/numbers", "/settings"];

// Marketing gets the inverse of the agent rule: an ALLOW-list, not a deny-list. A deny-list
// fails open - a page added later would be reachable by a role that was never meant to see
// it - and the whole point of this role is that it must not reach a conversation.
// /api/leads-export is the download proxy the Export Excel button hits.
const MARKETING_ALLOWED = ["/leads", "/summary", "/api/leads-export"];

// The dashboard is served under a basePath so it can ride through the API's single tunnel
// (see the @fastify/http-proxy registration in api/src/app.ts). NextResponse.redirect
// takes a raw URL and does NOT get basePath applied for us, unlike NextAuth's own `pages`
// redirects - so without this every unauthenticated request lands on a 404 instead of the login
// page.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/app";

// Static assets the browser fetches with no session of its own. A service worker in particular
// is fetched outside any document context, so answering it with a login PAGE fails registration
// on the MIME type - the PWA then installs and silently never receives a notification, which is
// the exact failure push exists to remove. Enforced here as well as in the matcher below,
// because the matcher is a deployment hint and the standalone server does not always honour it.
const PUBLIC_PATHS = ["/sw.js", "/manifest.webmanifest", "/favicon.ico"];

function isPublic(pathname: string): boolean {
  // /brand/ holds the logo files, which the login page shows before anyone is signed in.
  return PUBLIC_PATHS.includes(pathname) || pathname.startsWith("/icon-") || pathname.startsWith("/brand/");
}

function stripBasePath(pathname: string): string {
  if (!BASE_PATH || !pathname.startsWith(BASE_PATH)) return pathname;
  const rest = pathname.slice(BASE_PATH.length);
  // Whole segment only: "/app/leads" -> "/leads", but a hypothetical "/appointments" is
  // left alone rather than becoming "ointments".
  if (rest !== "" && !rest.startsWith("/")) return pathname;
  return rest || "/";
}

export const proxy = auth((req) => {
  // nextUrl.pathname INCLUDES the basePath here ("/app/leads", not "/leads") and
  // nextUrl.basePath is empty, so every prefix test below has to strip it first. Without
  // this the agent deny-list silently never matched, and /sw.js was answered with the login
  // page - the exact PWA failure the PUBLIC_PATHS comment above describes.
  const path = stripBasePath(req.nextUrl.pathname);
  if (isPublic(path)) return NextResponse.next();

  if (!req.auth?.user) {
    return NextResponse.redirect(new URL(`${BASE_PATH}/login`, req.url));
  }
  const role = (req.auth.user as { role?: string })?.role;
  if (role === "agent" && AGENT_BLOCKED.some((blocked) => path.startsWith(blocked))) {
    return NextResponse.redirect(new URL(`${BASE_PATH}/conversations`, req.url));
  }
  if (role === "marketing" && !MARKETING_ALLOWED.some((allowed) => path.startsWith(allowed))) {
    return NextResponse.redirect(new URL(`${BASE_PATH}/leads`, req.url));
  }
  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|icon-|brand/|sw\\.js|manifest\\.webmanifest|login).*)",
  ],
};
