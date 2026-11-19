import { BASE_PATH } from "@/lib/basePath";

/**
 * The IMPEPAC logo (Imperial Indopack). `compact` (sidebar header): the hexagon mark beside the
 * IMPEPAC name and the IMPERIAL INDOPACK line, as in the logo. `full` (login card): the whole logo.
 * The files live in public/brand; public/icon-192.png and icon-512.png carry the mark as the app icon.
 */
export function BrandMark({ variant = "compact" }: { variant?: "compact" | "full" }) {
  if (variant === "full") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a static file under the base path
      <img
        src={`${BASE_PATH}/brand/impepac-logo.png`}
        alt="IMPEPAC Imperial Indopack"
        width={160}
        height={147}
        style={{ display: "block", width: 160, height: "auto" }}
      />
    );
  }
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- a static file under the base path */}
      <img
        src={`${BASE_PATH}/brand/impepac-mark.png`}
        alt=""
        aria-hidden="true"
        width={30}
        height={30}
        style={{ width: 30, height: 30, flexShrink: 0, display: "block" }}
      />
      <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.05 }}>
        <span className="font-heading" style={{ color: "#2F6B26", fontWeight: 800, fontSize: 16, letterSpacing: "0.02em" }}>
          IMPEPAC
        </span>
        <span style={{ color: "#5F6B5A", fontWeight: 600, fontSize: 8.5, letterSpacing: "0.22em", marginTop: 2 }}>
          IMPERIAL INDOPACK
        </span>
      </span>
    </>
  );
}
