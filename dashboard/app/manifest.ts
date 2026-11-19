import type { MetadataRoute } from "next";

/**
 * App Router generates /manifest.webmanifest from this - no plugin, no static file to keep in
 * step with the icons. Next does NOT apply basePath to ANY field here, so every path is written
 * out in full. Getting this wrong is invisible until someone installs the app: an unprefixed
 * start_url launched the iOS home-screen icon straight at /team-queue, which 404s.
 *
 * display: "standalone" is not cosmetic on iOS: web push only works there for a site added to
 * the Home Screen, and only a standalone manifest makes "Add to Home Screen" produce one.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/app";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Imperial Indopack Dashboard",
    short_name: "Imperial",
    description: "Notifikasi chat yang perlu tim untuk Kertas Supreme dan Imperial Indopack",
    start_url: `${BASE_PATH}/team-queue`,
    // Without a scope the browser infers it from start_url's directory. Stated explicitly so
    // the whole dashboard counts as in-app; anything outside it opens in a normal browser tab.
    scope: `${BASE_PATH}/`,
    display: "standalone",
    background_color: "#F5F8F2",
    theme_color: "#586B34",
    lang: "id",
    icons: [
      { src: `${BASE_PATH}/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${BASE_PATH}/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `${BASE_PATH}/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
