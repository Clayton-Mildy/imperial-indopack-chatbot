import Link from "next/link";
import { getT } from "@/lib/i18n";
import { goLiveIssueLine } from "@/lib/settings";
import type { GoLiveIssue } from "@/types/api";

const linkStyle = { color: "#78350F" } as const;

/**
 * The amber strip under Pengaturan's header: "{n} hal belum siap untuk go-live" and one link per
 * issue, to the section (#…) or page (/…) where it is fixed. Nothing when all is ready, or when the
 * check itself could not be loaded (null).
 */
export async function GoLiveBanner({ issues }: { issues: GoLiveIssue[] | null }) {
  const t = await getT();
  const lines = (issues ?? []).map((i) => goLiveIssueLine(i, t)).filter((l) => l !== null);
  if (lines.length === 0) return null;
  return (
    <div
      role="alert"
      style={{ flexShrink: 0, background: "#FEF3C7", borderBottom: "1px solid #F3DC94", padding: "10px 32px", fontSize: 13, color: "#78350F", display: "flex", flexWrap: "wrap", gap: "8px 16px", alignItems: "center" }}
    >
      <b>{t("settings.golive.count", { n: lines.length })}</b>
      {lines.map((l, i) =>
        l.href.startsWith("#") ? (
          <a key={i} href={l.href} style={linkStyle}>{l.text}</a>
        ) : (
          <Link key={i} href={l.href} style={linkStyle}>{l.text}</Link>
        ),
      )}
    </div>
  );
}
