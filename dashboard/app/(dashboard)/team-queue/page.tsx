import { getEscalations } from "@/lib/api/escalations";
import { Header } from "@/components/layout/Header";
import Link from "next/link";
import { getT, type TFn } from "@/lib/i18n";
import type { Conversation } from "@/types/api";

function formatPhone(raw: string): string {
  const digits = raw.replace(/^\+/, "").replace(/\D/g, "");
  if (digits.startsWith("62") && digits.length >= 11) {
    const local = digits.slice(2);
    return `+62 ${local.slice(0, 3)}-${local.slice(3, 7)}-${local.slice(7)}`;
  }
  return raw.startsWith("+") ? raw : `+${digits}`;
}

function timeAgo(iso: string, t: TFn): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return t("escalations.agoMinutes", { n: diffMin });
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 48) return t("escalations.agoHours", { n: diffH });
  // A stale hand-off is the whole point of this queue - "432 jam lalu" hides it.
  return t("escalations.agoDays", { n: Math.floor(diffH / 24) });
}

// Moved from /escalations; rebuilt on the team-queue API in Task 20.
export default async function TeamQueuePage() {
  const t = await getT();
  let escalations: Conversation[] = [];

  try {
    escalations = await getEscalations();
  } catch (err) {
    console.warn("[team-queue] Fetch failed:", err);
  }

  return (
    <>
      <Header title={t("escalations.title")} />
      <main style={{ flex: 1, overflowY: "auto", padding: 32 }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <h1 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 700, color: "#1F2421" }}>{t("escalations.title")}</h1>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  background: "#D97706",
                  color: "white",
                  borderRadius: 9999,
                  fontSize: 12,
                  fontWeight: 700,
                  minWidth: 22,
                  height: 22,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "0 6px",
                }}
              >
                {escalations.length}
              </span>
              <span style={{ fontSize: 14, color: "#1F1F1F" }}>{t("escalations.waiting")}</span>
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#64748B" }}>{t("escalations.sortNote")}</div>
        </div>

        {escalations.length === 0 ? (
          <div
            style={{
              background: "white",
              border: "1px solid #E2E8F0",
              borderRadius: 6,
              padding: "40px 24px",
              textAlign: "center",
              color: "#64748B",
              fontSize: 14,
            }}
          >
            {t("escalations.empty")}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {escalations.map((esc) => {
              const contactName =
                esc.contact?.displayName ?? esc.contact?.waId ?? esc.contactId;
              const waId = esc.contact?.waId;

              return (
                <div
                  key={esc.id}
                  style={{
                    background: "white",
                    border: "1px solid #E2E8F0",
                    borderLeft: "4px solid #D97706",
                    borderRadius: 6,
                    padding: "20px 24px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                        <span style={{ fontSize: 15, fontWeight: 600, color: "#0A0A0A" }}>{contactName}</span>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            padding: "2px 8px",
                            background: "#FEF3C7",
                            color: "#B45309",
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 600,
                          }}
                        >
                          <span style={{ width: 6, height: 6, background: "#D97706", borderRadius: 999 }} />
                          {t("escalations.badge")}
                        </span>
                      </div>

                      {waId && (
                        <div style={{ fontSize: 12, color: "#64748B", marginBottom: 12 }}>
                          <span style={{ fontFamily: "JetBrains Mono, monospace" }}>{formatPhone(waId)}</span>
                        </div>
                      )}

                      {esc.escalationReason && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          <div>
                            <span style={{ fontSize: 11, fontWeight: 700, color: "#B45309", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                              {t("escalations.aiReason")}
                            </span>
                            <span style={{ fontSize: 13, color: "#1F1F1F", fontStyle: "italic", marginLeft: 6 }}>
                              {esc.escalationReason}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                    <div
                      style={{
                        textAlign: "right",
                        minWidth: 200,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-end",
                        justifyContent: "space-between",
                        alignSelf: "stretch",
                      }}
                    >
                      <div style={{ fontSize: 11, color: "#64748B" }}>{timeAgo(esc.escalatedAt ?? esc.updatedAt, t)}</div>
                      <Link
                        href={`/conversations/${esc.id}`}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          fontSize: 13,
                          fontWeight: 500,
                          color: "#445428",
                          textDecoration: "none",
                          border: "1px solid #D5DECF",
                          borderRadius: 4,
                          padding: "4px 12px",
                        }}
                      >
                        {t("escalations.viewConversation")}{" "}
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12,5 19,12 12,19"/>
                        </svg>
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
