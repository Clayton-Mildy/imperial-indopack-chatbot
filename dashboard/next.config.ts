import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // App Router is the default in Next.js 16
  // standalone emits .next/standalone/server.js with only the traced deps, so the
  // native Windows deploy ships ~80 MB instead of the full node_modules. Note that
  // .next/static is NOT copied into standalone — the build step has to do that.
  output: "standalone",
  // The PC has one public hostname (a single Cloudflare Tunnel, pointed at the API's port), so
  // the dashboard is reverse-proxied through the API under /app rather than getting a second
  // hostname - see the @fastify/http-proxy registration in api/src/app.ts. Without this,
  // every link and asset URL Next generates would be root-absolute and 404 behind the prefix.
  // Kept in an env var because the service-worker registration needs the identical value.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "/app",
  // basePath means the bare root serves nothing, so `npm run dev` prints a URL that 404s and
  // every existing bookmark breaks. `basePath: false` is what makes this rule match the real
  // root rather than being rewritten to /app/ - without it the redirect points at itself.
  async redirects() {
    return [
      {
        source: "/",
        destination: process.env.NEXT_PUBLIC_BASE_PATH ?? "/app",
        basePath: false,
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
