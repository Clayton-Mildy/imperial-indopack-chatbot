import Link from "next/link";
import { auth } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { LanguageSwitch } from "./LanguageSwitch";

interface HeaderProps {
  title: string;
  breadcrumb?: string;
  breadcrumbHref?: string;
}

export async function Header({ title, breadcrumb, breadcrumbHref }: HeaderProps) {
  const session = await auth();
  const t = await getT();
  const userName = session?.user?.name ?? session?.user?.email ?? t("header.defaultUser");
  const initials = userName
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <header
      className="flex-shrink-0 bg-white flex items-center justify-between"
      style={{
        height: 56,
        borderBottom: "1px solid #E1E7DC",
        padding: "0 32px",
      }}
    >
      {/* Left: title / breadcrumb */}
      <div style={{ fontSize: 15, fontWeight: 600, color: "#1F2421" }}>
        {breadcrumb ? (
          <span className="inline-flex items-center gap-2">
            {/* next/link, not a raw <a>: next.config.ts sets basePath "/app", and Next only
                applies it to Link and router.push. A plain anchor sent the back-link to
                /conversations at the origin root, where only the API is listening - a 404.
                Same trap the Sidebar documents for next-auth's callbackUrl. */}
            <Link
              href={breadcrumbHref ?? "#"}
              style={{
                color: "#5F6B5A",
                fontSize: 14,
                fontWeight: 500,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"/>
                <polyline points="12,19 5,12 12,5"/>
              </svg>
              {breadcrumb}
            </Link>
            <span style={{ color: "#CBD5E1" }}>/</span>
            <span style={{ color: "#1F2421" }}>{title}</span>
          </span>
        ) : (
          title
        )}
      </div>

      {/* Right: user */}
      <div className="flex items-center gap-2.5">
        <LanguageSwitch />
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 9999,
            background: "#586B34",
            color: "white",
            fontSize: 11,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {initials}
        </div>
        <span style={{ fontSize: 13, fontWeight: 500, color: "#1F2421" }}>
          {userName}
        </span>
      </div>
    </header>
  );
}
