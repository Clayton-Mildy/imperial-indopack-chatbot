"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateLead } from "@/actions/leadActions";
import { ManualMark } from "@/components/ManualMark";
import { useLang, useT } from "@/lib/i18n/LangProvider";
import { formatDate, formatNumber, formatRupiah, type Lang, type TFn, type TKey } from "@/lib/i18n/core";
import type { Lead, LeadEvent, LeadOrder, LeadKind, LeadStatus } from "@/types/api";

const STATUS_KEYS: LeadStatus[] = ["new", "contacted", "quoted", "won", "lost"];
const KIND_KEYS: LeadKind[] = ["lead", "kurir", "status_pesanan", "lamaran_kerja", "supplier", "lainnya"];

const STATUS_COLOR: Record<LeadStatus, { background: string; color: string }> = {
  new: { background: "#F1F5F9", color: "#475569" },
  contacted: { background: "#DBEAFE", color: "#1D4ED8" },
  quoted: { background: "#FEF3C7", color: "#B45309" },
  won: { background: "#DCFCE7", color: "#15803D" },
  lost: { background: "#FEE2E2", color: "#B91C1C" },
};

const TEMPERATURE_BADGE: Record<string, { label: string; background: string; color: string }> = {
  hot: { label: "Hot", background: "#FBE3DA", color: "#9A2E12" },
  cold: { label: "Cold", background: "#E2EAF2", color: "#2F4A66" },
};

const ACTOR_STYLE: Record<LeadEvent["actor"], { background: string; color: string }> = {
  ai: { background: "#EDE9FE", color: "#6D28D9" },
  staff: { background: "#DBEAFE", color: "#1D4ED8" },
  system: { background: "#F1F5F9", color: "#475569" },
};

const INTEREST_KEYS = ["product_sought", "recommended_product", "business_type", "business_name"];
const NEED_KEYS = ["apa_yang_anda_butuhkan", "kebutuhan", "catatan", "nama_perusahaan", "pesan"];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const EVIDENCE_MAX = 200;

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #E2E8F0",
  borderRadius: 8,
  padding: 20,
};
const cardTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "#64748B",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  margin: "0 0 12px",
};
const selectStyle: React.CSSProperties = {
  height: 32,
  padding: "0 8px",
  fontSize: 13,
  border: "1px solid #CBD5E1",
  borderRadius: 4,
  fontFamily: "inherit",
  background: "#fff",
};

function pick(bag: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = bag[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** "{h} jam {m} mnt" under a day, "{d} hari" from a day up. */
function closeDuration(startIso: string, endIso: string, t: TFn): string | null {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  if (ms >= DAY) return t("leadDetail.dur.day", { d: Math.floor(ms / DAY) });
  const h = Math.floor(ms / HOUR);
  const m = Math.floor((ms % HOUR) / 60_000);
  return h === 0 ? t("leadDetail.dur.min", { m }) : t("leadDetail.dur.minHour", { h, m });
}

const WITH_TIME: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

function Badge({ children, background, color }: { children: React.ReactNode; background: string; color: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 4, background, color }}>
      {children}
    </span>
  );
}

function eventTitle(ev: LeadEvent, isFirst: boolean, t: TFn): string {
  const status = (s: LeadStatus | null) => (s ? t(`leads.status.${s}` as TKey) : "—");
  const kind = (k: LeadKind | null) => (k ? t(`kind.${k}` as TKey) : "—");
  if (ev.toStatus !== null && ev.toStatus !== ev.fromStatus) {
    if (isFirst && ev.fromStatus === null) return t("leadDetail.firstContact");
    return `${status(ev.fromStatus)} → ${status(ev.toStatus)}`;
  }
  if (ev.toKind !== null && ev.toKind !== ev.fromKind) {
    return t("leadDetail.kindChange", { from: kind(ev.fromKind), to: kind(ev.toKind) });
  }
  return isFirst ? t("leadDetail.firstContact") : "—";
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0", borderBottom: "1px solid #F1F5F9", fontSize: 13 }}>
      <span style={{ color: "#64748B" }}>{label}</span>
      <span style={{ color: "#0A0A0A", textAlign: "right", fontWeight: 500 }}>{value}</span>
    </div>
  );
}

export function LeadDetailClient({
  lead,
  events,
  orders,
  previousLead,
  name,
  readOnly,
}: {
  lead: Lead;
  events: LeadEvent[];
  orders: LeadOrder[];
  previousLead: Lead | null;
  name: string;
  readOnly: boolean;
}) {
  const t = useT();
  const lang: Lang = useLang();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<LeadStatus>(lead.status);
  const [kind, setKind] = useState<LeadKind>(lead.kind);

  // Props are the server truth after router.refresh(); local state only bridges the gap.
  const [seen, setSeen] = useState({ status: lead.status, kind: lead.kind });
  if (seen.status !== lead.status || seen.kind !== lead.kind) {
    setSeen({ status: lead.status, kind: lead.kind });
    setStatus(lead.status);
    setKind(lead.kind);
  }

  const fmt = (d: string, o?: Intl.DateTimeFormatOptions) => formatDate(d, lang, o);
  const temp = lead.leadTemperature ? TEMPERATURE_BADGE[lead.leadTemperature] : undefined;
  const statusColor = STATUS_COLOR[status] ?? STATUS_COLOR.new;

  function save(updates: { status?: LeadStatus; kind?: LeadKind }, revert: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await updateLead(lead.id, updates).catch(() => ({ ok: false, error: undefined as string | undefined }));
      if (!result.ok) {
        revert();
        setError(result.error ?? t("leads.saveFailed"));
        return;
      }
      router.refresh();
    });
  }

  function onStatus(next: LeadStatus) {
    const prev = status;
    setStatus(next);
    save({ status: next }, () => setStatus(prev));
  }

  function onKind(next: LeadKind) {
    const prev = kind;
    setKind(next);
    save({ kind: next }, () => setKind(prev));
  }

  const showProof = (lead.status === "won" || lead.status === "lost") && Boolean(lead.outcomeEvidence);
  const chatHref = lead.conversationId ? `/conversations/${lead.conversationId}` : null;
  const proofHref =
    chatHref && lead.outcomeMessageId ? `${chatHref}#msg-${lead.outcomeMessageId}` : chatHref;

  const startedAt = lead.firstContactAt ?? lead.matchedAt ?? lead.submittedAt;
  const duration = lead.closedAt ? closeDuration(startedAt, lead.closedAt, t) : null;
  const need = pick(lead.payload, NEED_KEYS) ?? pick(lead.contactProfile, INTEREST_KEYS);

  return (
    <div style={{ padding: "24px 32px" }}>
      {/* Title row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0A0A0A", margin: 0 }}>{name}</h1>
            {temp && <Badge background={temp.background} color={temp.color}>{temp.label}</Badge>}
            {lead.previousLeadId && (
              <Badge background="#FEF3C7" color="#B45309">{t("leads.tag.returning")}</Badge>
            )}
          </div>
          {lead.waId && (
            <div style={{ marginTop: 4, fontSize: 13, color: "#64748B", fontFamily: "var(--font-mono), 'JetBrains Mono', monospace" }}>
              {lead.waId}
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#64748B" }}>
            {t("leadDetail.kindLabel")}
            <select
              value={kind}
              disabled={readOnly || pending}
              onChange={(e) => onKind(e.target.value as LeadKind)}
              style={{ ...selectStyle, cursor: readOnly ? "default" : "pointer" }}
            >
              {KIND_KEYS.map((k) => (
                <option key={k} value={k}>{t(`kind.${k}` as TKey)}</option>
              ))}
            </select>
            {lead.kindSetBy === "staff" && <ManualMark />}
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#64748B" }}>
            {t("leadDetail.statusLabel")}
            <select
              value={status}
              disabled={readOnly || pending}
              onChange={(e) => onStatus(e.target.value as LeadStatus)}
              style={{
                ...selectStyle,
                fontWeight: 600,
                cursor: readOnly ? "default" : "pointer",
                background: statusColor.background,
                color: statusColor.color,
              }}
            >
              {STATUS_KEYS.map((k) => (
                <option key={k} value={k}>{t(`leads.status.${k}` as TKey)}</option>
              ))}
            </select>
            {lead.humanUpdatedAt && <ManualMark at={lead.humanUpdatedAt} name={lead.statusSetByName} />}
          </label>
          {chatHref && !readOnly && (
            <Link
              href={chatHref}
              style={{ height: 32, display: "inline-flex", alignItems: "center", padding: "0 14px", fontSize: 13, fontWeight: 600, borderRadius: 4, background: "#586B34", color: "#fff", textDecoration: "none" }}
            >
              {t("leadDetail.openChat")}
            </Link>
          )}
        </div>
      </div>
      {error && <div style={{ marginBottom: 12, fontSize: 13, color: "#B91C1C" }}>{error}</div>}

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
        {/* Left: proof + history */}
        <div style={{ flex: "2 1 420px", minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
          {showProof && (
            <div style={{ ...cardStyle, borderLeft: `4px solid ${lead.status === "won" ? "#15803D" : "#B91C1C"}` }}>
              <h2 style={cardTitle}>
                {lead.status === "won" ? t("leadDetail.proofTitleWon") : t("leadDetail.proofTitleLost")}
                {lead.status === "lost" && lead.lostReason ? ` · ${t(`lostReason.${lead.lostReason}` as TKey)}` : ""}
              </h2>
              <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 6 }}>{t("leadDetail.proofBy")}</div>
              <blockquote style={{ margin: 0, padding: "8px 12px", background: "#F8FAFC", borderRadius: 4, fontSize: 14, color: "#0A0A0A", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                “{lead.outcomeEvidence}”
              </blockquote>
              {proofHref && !readOnly && (
                <Link href={proofHref} style={{ display: "inline-block", marginTop: 10, fontSize: 13, fontWeight: 600, color: "#445428", textDecoration: "none" }}>
                  {t("leadDetail.proofLink")} →
                </Link>
              )}
              {!readOnly && (
                <div style={{ marginTop: 8, fontSize: 12, color: "#64748B" }}>{t("leadDetail.proofHint")}</div>
              )}
            </div>
          )}

          <div style={cardStyle}>
            <h2 style={cardTitle}>{t("leadDetail.history")}</h2>
            {events.length === 0 ? (
              <div style={{ fontSize: 13, color: "#94A3B8" }}>{t("leadDetail.noHistory")}</div>
            ) : (
              <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {events.map((ev, i) => (
                  <li key={ev.id} style={{ display: "flex", gap: 12, paddingBottom: 14 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 99, background: "#CBD5E1", marginTop: 6, flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "#0A0A0A" }}>{eventTitle(ev, i === 0, t)}</span>
                        <Badge background={ACTOR_STYLE[ev.actor].background} color={ACTOR_STYLE[ev.actor].color}>
                          {t(`leadDetail.actor.${ev.actor}` as TKey)}
                        </Badge>
                        <span style={{ fontSize: 12, color: "#94A3B8" }}>{fmt(ev.createdAt, WITH_TIME)}</span>
                      </div>
                      {ev.evidence && (
                        <div style={{ marginTop: 3, fontSize: 12, color: "#64748B", overflowWrap: "anywhere" }}>
                          {truncate(ev.evidence, EVIDENCE_MAX)}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>

        {/* Right: info + previous lead */}
        <div style={{ flex: "1 1 280px", minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={cardStyle}>
            <h2 style={cardTitle}>{t("leadDetail.info")}</h2>
            <InfoRow label={t("leads.col.chatStarted")} value={lead.conversationStartedAt ? fmt(lead.conversationStartedAt) : t("leads.noChat")} />
            <InfoRow label={t("leads.col.lastChat")} value={lead.lastChatAt ? fmt(lead.lastChatAt) : t("leads.noChat")} />
            {lead.closedAt && (lead.status === "won" || lead.status === "lost") && (
              <InfoRow label={lead.status === "won" ? t("leadDetail.wonOn") : t("leadDetail.lostOn")} value={fmt(lead.closedAt)} />
            )}
            {duration && <InfoRow label={t("leadDetail.closeTime")} value={duration} />}
            <InfoRow label={t("leads.col.need")} value={need ?? "—"} />
            <InfoRow
              label={t("leads.col.totalOrders")}
              value={<>{formatNumber(lead.totalOrders, lang)}{lead.totalOrdersSetAt && <ManualMark at={lead.totalOrdersSetAt} name={lead.totalOrdersSetByName} />}</>}
            />
            <InfoRow
              label={t("leads.col.totalDeal")}
              value={<>{lead.dealValueIdr ? formatRupiah(lead.dealValueIdr) : "—"}{lead.dealValueSetAt && <ManualMark at={lead.dealValueSetAt} name={lead.dealValueSetByName} />}</>}
            />
          </div>

          {/* The proof behind Total Order: the customer's own order messages the AI counted. */}
          <div style={cardStyle}>
            <h2 style={cardTitle}>{t("leadDetail.orders")}</h2>
            <div style={{ fontSize: 12, color: "#64748B", marginBottom: 10 }}>
              {lead.totalOrdersSetAt ? t("leadDetail.ordersManual") : t("leadDetail.ordersHint")}
            </div>
            {orders.length === 0 ? (
              <div style={{ fontSize: 13, color: "#94A3B8" }}>{t("leadDetail.noOrders")}</div>
            ) : (
              <ol style={{ margin: 0, paddingLeft: 18 }}>
                {orders.map((o) => (
                  <li key={o.id} style={{ marginBottom: 8, fontSize: 12, color: "#334155" }}>
                    <span style={{ color: "#94A3B8" }}>{fmt(o.createdAt, WITH_TIME)}</span>
                    {o.evidence && (
                      <div style={{ marginTop: 2, overflowWrap: "anywhere" }}>{truncate(o.evidence, EVIDENCE_MAX)}</div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>

          {previousLead && (
            <div style={cardStyle}>
              <h2 style={cardTitle}>{t("leadDetail.previous")}</h2>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                {previousLead.closedAt && <span style={{ fontSize: 13, color: "#334155" }}>{fmt(previousLead.closedAt)}</span>}
                <Badge background={STATUS_COLOR.lost.background} color={STATUS_COLOR.lost.color}>{t("leads.status.lost")}</Badge>
                {previousLead.lostReason && (
                  <span style={{ fontSize: 12, color: "#64748B" }}>{t(`lostReason.${previousLead.lostReason}` as TKey)}</span>
                )}
              </div>
              {previousLead.outcomeEvidence && (
                <div style={{ fontSize: 12, color: "#64748B", overflowWrap: "anywhere" }}>
                  {truncate(previousLead.outcomeEvidence, EVIDENCE_MAX)}
                </div>
              )}
              <Link href={`/leads/${previousLead.id}`} style={{ display: "inline-block", marginTop: 8, fontSize: 13, fontWeight: 600, color: "#445428", textDecoration: "none" }}>
                {t("leadDetail.previousOpen")}
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
