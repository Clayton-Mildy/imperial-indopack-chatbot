"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { signOut } from "next-auth/react";
import { getTeamQueueCount } from "@/actions/teamQueueActions";
import { roleLabel as roleLabelOf } from "@/lib/roles";
import { useT } from "@/lib/i18n/LangProvider";
import type { TKey } from "@/lib/i18n/core";
import { BrandMark } from "./BrandMark";
import { NotificationToggle } from "./NotificationToggle";

// next-auth resolves callbackUrl against the window origin, not Next's router, so unlike
// router.push("/conversations") it does NOT get the basePath applied for us - a bare "/login"
// lands outside the app entirely.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/app";

// Grouped by what someone is trying to do (docs/superpowers/designs/*.dc.html sidebar). One
// renderer for every entry, so the active and admin-only rules live in one place.
const NAV_GROUPS: {
  title: TKey;
  items: {
    label: TKey;
    href: string;
    adminOnly?: boolean;
    /** Shows the waiting-for-team count badge. */
    showsQueueCount?: boolean;
  }[];
}[] = [
  {
    title: "nav.inbox",
    items: [
      { label: "nav.conversations", href: "/conversations" },
      { label: "nav.teamQueue", href: "/team-queue", showsQueueCount: true },
    ],
  },
  {
    title: "nav.sales",
    items: [
      { label: "nav.summary", href: "/summary" },
      { label: "nav.leads", href: "/leads" },
    ],
  },
  {
    title: "nav.products",
    items: [{ label: "nav.catalog", href: "/catalog" }],
  },
  {
    title: "nav.system",
    items: [
      { label: "nav.numbers", href: "/numbers", adminOnly: true },
      { label: "nav.testPrompt", href: "/test-prompt" },
      { label: "nav.activity", href: "/activity" },
      { label: "nav.admin", href: "/admin", adminOnly: true },
      { label: "nav.settings", href: "/settings", adminOnly: true },
    ],
  },
];

export function Sidebar({ role, userName }: { role: string; userName: string }) {
  const t = useT();
  const isAdmin = role === "admin";
  const isMarketing = role === "marketing";
  const roleLabel = roleLabelOf(role, t);
  const initials = userName.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const pathname = usePathname();
  const [queueCount, setQueueCount] = useState<number | null>(null);

  // Refreshed on navigation, not on a timer: polling is 17,280 requests a day per open tab for
  // a badge nobody is watching most of that time. Push notifications carry the urgency; the badge
  // only has to be right when someone is looking at it.
  useEffect(() => {
    let active = true;
    void getTeamQueueCount().then((count) => {
      if (active) setQueueCount(count);
    });
    return () => {
      active = false;
    };
  }, [pathname]);

  function isActive(href: string) {
    return pathname.startsWith(href);
  }

  const roleBadgeStyle: React.CSSProperties = {
    background: isAdmin ? "#EAF2DD" : "#F1F5F1",
    color: isAdmin ? "#3E4C24" : "#5F6B5A",
    fontSize: 11,
    fontWeight: 600,
    padding: "1px 6px",
    borderRadius: 4,
  };

  return (
    <div className="flex flex-col h-full" style={{ width: 240, background: "#F8FAF6" }}>
      {/* Brand: the Royale "S" mark beside the company name */}
      <div
        className="flex items-center flex-shrink-0"
        style={{ height: 56, padding: "0 20px", gap: 10, borderBottom: "1px solid #E1E7DC" }}
      >
        <BrandMark />
      </div>

      {/* Navigation */}
      <nav aria-label={t("nav.mainMenu")} className="flex-1 overflow-y-auto" style={{ padding: "12px 8px" }}>
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter(
            ({ adminOnly, href }) =>
              (!adminOnly || isAdmin) &&
              // Marketing gets Leads and the Summary report, nothing else - matching the allow-list in proxy.ts,
              // which is what actually enforces it.
              (!isMarketing || href === "/leads" || href === "/summary")
          );
          // An agent sees no admin-only items in some groups — don't leave a bare header.
          if (items.length === 0) return null;
          return (
            <div key={group.title} style={{ marginBottom: 14 }}>
              <div
                style={{
                  padding: "0 12px",
                  marginBottom: 4,
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#6B7A66",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                {t(group.title)}
              </div>
              {items.map(({ label, href, showsQueueCount }) => {
                const active = isActive(href);
                const badge =
                  showsQueueCount && queueCount !== null && queueCount > 0 ? String(queueCount) : null;
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className="flex items-center relative"
                    style={{
                      height: 36,
                      // Indented under the section label so items read as menu entries, not headings.
                      padding: "0 12px 0 22px",
                      gap: 8,
                      borderRadius: 6,
                      marginBottom: 2,
                      fontSize: 13,
                      fontWeight: active ? 600 : 500,
                      textDecoration: "none",
                      background: active ? "#EAF2DD" : "transparent",
                      color: active ? "#3E4C24" : "#1F2421",
                      borderLeft: active ? "3px solid #586B34" : "3px solid transparent",
                    }}
                  >
                    <span className="flex-1">{t(label)}</span>
                    {badge && (
                      <span
                        style={{
                          background: "#B45309",
                          color: "white",
                          borderRadius: 9999,
                          fontSize: 11,
                          fontWeight: 600,
                          minWidth: 18,
                          height: 18,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: "0 5px",
                        }}
                      >
                        {badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* Notifications: the only way a hand-off reaches a phone that is not looking at this page. */}
      <div style={{ padding: "0 12px 8px", flexShrink: 0 }}>
        <NotificationToggle />
      </div>

      {/* Footer: user info — click to open popup */}
      <div style={{ padding: "10px 12px", borderTop: "1px solid #E1E7DC", flexShrink: 0, position: "relative" }}>
        {/* User dropdown popup */}
        {showUserMenu && (
          <>
            <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setShowUserMenu(false)} />
            <div style={{ position: "absolute", bottom: "calc(100% + 8px)", left: 12, right: 12, background: "white", border: "1px solid #E1E7DC", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", zIndex: 50, padding: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#1F2421", marginBottom: 2 }}>{userName}</div>
              <div style={{ marginBottom: 12 }}>
                <span style={roleBadgeStyle}>{roleLabel}</span>
              </div>
              <div style={{ borderTop: "1px solid #EEF2EA", paddingTop: 10 }}>
                {!showLogoutConfirm ? (
                  <button
                    onClick={() => setShowLogoutConfirm(true)}
                    style={{ width: "100%", height: 34, background: "#F8FAF6", border: "1px solid #E1E7DC", borderRadius: 6, fontSize: 13, fontWeight: 500, color: "#1F2421", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, padding: "0 10px" }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                      <polyline points="16,17 21,12 16,7"/>
                      <line x1="21" y1="12" x2="9" y2="12"/>
                    </svg>
                    {t("sidebar.logout")}
                  </button>
                ) : (
                  <div>
                    <div style={{ fontSize: 12, color: "#5F6B5A", marginBottom: 8 }}>{t("sidebar.logoutConfirm")}</div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={() => setShowLogoutConfirm(false)}
                        style={{ flex: 1, height: 32, background: "white", border: "1px solid #D5DECF", borderRadius: 6, fontSize: 12, fontWeight: 500, color: "#5F6B5A", cursor: "pointer" }}
                      >
                        {t("sidebar.cancel")}
                      </button>
                      <button
                        onClick={() => signOut({ callbackUrl: `${BASE_PATH}/login` })}
                        style={{ flex: 1, height: 32, background: "#586B34", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, color: "white", cursor: "pointer" }}
                      >
                        {t("sidebar.logoutYes")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* Clickable user row */}
        <button
          onClick={() => { setShowUserMenu((v) => !v); setShowLogoutConfirm(false); }}
          style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, background: "transparent", border: "none", cursor: "pointer", padding: "4px 4px", borderRadius: 6, textAlign: "left" }}
        >
          <div style={{ width: 32, height: 32, borderRadius: 9999, background: "#586B34", color: "white", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            {initials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#1F2421", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {userName}
            </div>
            <div style={{ marginTop: 2 }}>
              <span style={roleBadgeStyle}>{roleLabel}</span>
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <polyline points="18,15 12,9 6,15"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
