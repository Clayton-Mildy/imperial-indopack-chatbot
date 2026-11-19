import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthBasePath } from "@/components/AuthBasePath";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/app";

export const metadata: Metadata = {
  title: "Imperial Indopack Dashboard",
  description: "Dashboard tim penjualan WhatsApp Kertas Supreme dan Imperial Indopack",
  manifest: `${BASE_PATH}/manifest.webmanifest`,
  // iOS reads these rather than the manifest when the site is added to the Home Screen - and on
  // iOS, Home Screen installation is the only way web push works at all.
  appleWebApp: { capable: true, title: "Imperial", statusBarStyle: "default" },
  icons: { icon: `${BASE_PATH}/icon-192.png`, apple: `${BASE_PATH}/icon-192.png` },
};

export const viewport: Viewport = {
  themeColor: "#586B34",
  // A fixed width, NOT device-width: this is a desktop layout - a 240px sidebar beside an
  // overflow-hidden pane - so at device-width a 390px phone renders ~150px of content and clips
  // the rest with nothing to scroll. Declaring 1024 makes the phone fit the whole dashboard to
  // the screen instead: zoomed out, pinch-zoomable, pannable. 1024 rather than 1280 because it
  // is the narrowest width the tables still lay out at, so it scales down the least.
  width: 1024,
  // Explicitly undefined, not omitted: Next injects `initial-scale=1` unless you pass undefined,
  // and that pins the page at 1:1, so the phone would open showing only the top-left ~390px.
  // Dropping it is what lets the browser pick a scale that fits.
  initialScale: undefined,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body>
        <AuthBasePath>{children}</AuthBasePath>
      </body>
    </html>
  );
}
