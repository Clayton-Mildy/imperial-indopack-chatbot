"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { updateLead } from "@/actions/leadActions";
import { BrandTags } from "@/components/BrandTag";
import { ManualMark } from "@/components/ManualMark";
import { BRAND_SLUGS, BRAND_TAG, brandSlugs, type BrandSlug } from "@/lib/brands";
import { formatQty, formatWait } from "@/lib/format";
import { useLang, useT } from "@/lib/i18n/LangProvider";
import { formatDate, formatNumber, type Lang, type TFn, type TKey } from "@/lib/i18n/core";
import { sizeText } from "@/lib/leads/items";
import { fromItems, productText, quotedPriceText, toItemsPayload, type ItemRow } from "@/lib/leads/itemsForm";
import type { Lead, LeadDetailExtras, LeadEvent, LeadKind, LeadStatus, OrderItem } from "@/types/api";

const STATUS_KEYS: LeadStatus[] = ["new", "contacted", "quoted", "won", "lost"];
const KIND_KEYS: LeadKind[] = ["lead", "kurir", "status_pesanan", "lamaran_kerja", "supplier", "lainnya"];

// Written by the AI each turn. "Hot"/"Cold" stay in English: the sales team uses the words as-is.
const TEMPERATURE_BADGE: Record<string, { label: string; background: string; color: string }> = {
  hot: { label: "Hot", background: "#FBE3DA", color: "#9A2E12" },
  cold: { label: "Cold", background: "#E2EAF2", color: "#2F4A66" },
};

// The history dot: green for a win, red for a loss, blue for a quote, grey for the rest.
const EVENT_DOT: Partial<Record<LeadStatus, string>> = { quoted: "#0369A1", won: "#15803D", lost: "#B91C1C" };

/** The API's limits (PatchLeadBodySchema): 50 items, a 200-character product, a 100-character size. */
const MAX_ITEMS = 50;

const EVIDENCE_MAX = 200;

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #E1E7DC",
  borderRadius: 8,
  padding: 18,
};
const cardTitle: React.CSSProperties = { fontSize: 14, fontWeight: 600, color: "#1F2421", margin: 0 };
const fieldLabel: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#5F6B5A" };
const control: React.CSSProperties = {
  font: "inherit",
  fontSize: 13,
  height: 36,
  padding: "0 10px",
  border: "1px solid #D5DECF",
  borderRadius: 6,
  background: "#fff",
  color: "#1F2421",
  boxSizing: "border-box",
  width: "100%",
  minWidth: 0,
};
const outlineBtn: React.CSSProperties = {
  font: "inherit",
  fontSize: 12.5,
  fontWeight: 600,
  height: 30,
  padding: "0 12px",
  border: "1px solid #D5DECF",
  borderRadius: 6,
  background: "#fff",
  color: "#1F2421",
  cursor: "pointer",
};
const primaryBtn: React.CSSProperties = { ...outlineBtn, border: "1px solid #586B34", background: "#586B34", color: "#fff" };
const th: React.CSSProperties = {
  padding: "9px 12px",
  fontSize: 11,
  fontWeight: 700,
  color: "#5F6B5A",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};
const VIEW_COLS = "2.2fr 1fr 1fr 1fr 1.2fr";
const EDIT_COLS = "2.2fr 1fr 0.8fr 0.8fr 1fr 32px";

const WITH_TIME: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};
const DAY_TIME: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** 6281200000011 -> '0812-0000-0011', the way the designs write a number. */
function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const local = digits.startsWith("62") ? `0${digits.slice(2)}` : digits;
  return local.length >= 10 ? `${local.slice(0, 4)}-${local.slice(4, 8)}-${local.slice(8)}` : raw;
}

function Pill({ children, background, color }: { children: React.ReactNode; background: string; color: string }) {
  return (
    <span style={{ fontSize: 11.5, fontWeight: 700, padding: "2px 8px", borderRadius: 9999, background, color, whiteSpace: "nowrap" }}>
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
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ color: "#5F6B5A" }}>{label}</span>
      <span style={{ textAlign: "right", overflowWrap: "anywhere" }}>{value}</span>
    </div>
  );
}

function designText(item: OrderItem, t: TFn): string {
  if (item.has_design === true) return t("leadDetail.items.design.yes");
  if (item.has_design === false) return t("leadDetail.items.design.no");
  return "—";
}

function qtyCell(item: OrderItem, lang: Lang): string {
  if (item.qty === undefined || item.qty <= 0) return "—";
  return item.qty_unit ? formatQty(item.qty, item.qty_unit, lang) : formatNumber(item.qty, lang);
}

type EditRow = ItemRow & { key: number };

export function LeadDetailClient({
  lead,
  events,
  previousLead,
  extras,
  name,
  readOnly,
}: {
  lead: Lead;
  events: LeadEvent[];
  previousLead: Lead | null;
  extras: LeadDetailExtras;
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

  // "Barang yang diminta" edit mode: the rows as typed, and the brand checkboxes.
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<EditRow[]>([]);
  const [brands, setBrands] = useState<BrandSlug[]>([]);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const nextKey = useRef(0);

  // Props are the server truth after router.refresh(); local state only bridges the gap.
  const [seen, setSeen] = useState({ status: lead.status, kind: lead.kind });
  if (seen.status !== lead.status || seen.kind !== lead.kind) {
    setSeen({ status: lead.status, kind: lead.kind });
    setStatus(lead.status);
    setKind(lead.kind);
  }

  const fmt = (d: string, o?: Intl.DateTimeFormatOptions) => formatDate(d, lang, o);
  const temp = lead.leadTemperature ? TEMPERATURE_BADGE[lead.leadTemperature] : undefined;
  const leadBrands = brandSlugs(lead.brands);

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

  const blankRow = (): EditRow => ({ key: nextKey.current++, product: "", size: "", qty: "", qtyUnit: "pcs", design: "" });

  function startEdit() {
    const stored = fromItems(lead.items).map((r) => ({ ...r, key: nextKey.current++ }));
    setRows(stored.length > 0 ? stored : [blankRow()]);
    setBrands(leadBrands);
    setItemsError(null);
    setEditing(true);
  }

  function setRow(key: number, patch: Partial<ItemRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function toggleBrand(slug: BrandSlug, on: boolean) {
    setBrands((bs) => BRAND_SLUGS.filter((s) => (s === slug ? on : bs.includes(s))));
  }

  function saveItems() {
    setItemsError(null);
    startTransition(async () => {
      const result = await updateLead(lead.id, { items: toItemsPayload(rows), brands }).catch(() => ({
        ok: false,
        error: undefined as string | undefined,
      }));
      if (!result.ok) {
        setItemsError(result.error ?? t("leads.saveFailed"));
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  const closed = lead.status === "won" || lead.status === "lost";
  const showProof = closed && Boolean(lead.outcomeEvidence);
  const chatHref = lead.conversationId ? `/conversations/${lead.conversationId}` : null;
  const proofHref = chatHref && lead.outcomeMessageId ? `${chatHref}#msg-${lead.outcomeMessageId}` : chatHref;
  const firstContact = lead.firstContactAt ?? lead.matchedAt ?? lead.submittedAt;
  const source =
    extras.source.kind === "ad"
      ? extras.source.headline
        ? t("leadDetail.source.adHeadline", { headline: extras.source.headline })
        : t("leadDetail.source.ad")
      : t("leadDetail.source.direct");

  return (
    <main style={{ flex: 1, overflowY: "auto", padding: "24px 32px 32px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
        <div style={{ flex: "2 1 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Who: name and business, brands, Hot/Cold, the number, and the chat. */}
          <div style={{ ...card, display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <h1 style={{ fontSize: 18, fontWeight: 700, color: "#1F2421", margin: 0, overflowWrap: "anywhere" }}>
                {lead.company ? `${name} · ${lead.company}` : name}
              </h1>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                {leadBrands.length > 0 && <BrandTags brands={leadBrands} />}
                {temp && <Pill background={temp.background} color={temp.color}>{temp.label}</Pill>}
                {lead.previousLeadId && <Pill background="#FEF3C7" color="#B45309">{t("leads.tag.returning")}</Pill>}
                {lead.waId && <span style={{ fontSize: 12, color: "#5F6B5A" }}>{formatPhone(lead.waId)}</span>}
              </div>
            </div>
            {chatHref && !readOnly && (
              <Link
                href={chatHref}
                style={{ fontSize: 13, fontWeight: 600, height: 34, padding: "0 14px", borderRadius: 6, background: "#586B34", color: "#fff", textDecoration: "none", display: "inline-flex", alignItems: "center" }}
              >
                {t("leadDetail.openChat")}
              </Link>
            )}
          </div>

          {/* Status and kind, saved on change. A staff choice locks the field against the AI. */}
          <div style={card}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label htmlFor="lt-status" style={fieldLabel}>
                  {t("leadDetail.statusLabel")}
                  {lead.humanUpdatedAt && <ManualMark at={lead.humanUpdatedAt} name={lead.statusSetByName} />}
                </label>
                <select
                  id="lt-status"
                  value={status}
                  disabled={readOnly || pending}
                  onChange={(e) => onStatus(e.target.value as LeadStatus)}
                  style={{ ...control, cursor: readOnly ? "default" : "pointer" }}
                >
                  {STATUS_KEYS.map((k) => (
                    <option key={k} value={k}>{t(`leads.status.${k}` as TKey)}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label htmlFor="lt-kind" style={fieldLabel}>
                  {t("leadDetail.kindLabel")}
                  {lead.kindSetBy === "staff" && <ManualMark />}
                </label>
                <select
                  id="lt-kind"
                  value={kind}
                  disabled={readOnly || pending}
                  onChange={(e) => onKind(e.target.value as LeadKind)}
                  style={{ ...control, cursor: readOnly ? "default" : "pointer" }}
                >
                  {KIND_KEYS.map((k) => (
                    <option key={k} value={k}>{t(`kind.${k}` as TKey)}</option>
                  ))}
                </select>
              </div>
            </div>
            {error && <div role="alert" style={{ marginTop: 10, fontSize: 13, color: "#B91C1C" }}>{error}</div>}
          </div>

          {/* Barang yang diminta: the items (and brands) the AI collected, or staff's own list. */}
          <div style={{ ...card, padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid #EEF2EA", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <h2 style={cardTitle}>
                {t("leadDetail.items")}
                {lead.orderFieldsSetAt && <ManualMark at={lead.orderFieldsSetAt} />}
              </h2>
              {!readOnly && !editing && (
                <button type="button" onClick={startEdit} disabled={pending} style={outlineBtn}>
                  {t("leadDetail.items.edit")}
                </button>
              )}
            </div>

            {!editing ? (
              <div style={{ overflowX: "auto" }}>
                <div style={{ minWidth: 560, fontSize: 13 }}>
                  <div style={{ display: "grid", gridTemplateColumns: VIEW_COLS, background: "#F8FAF6" }}>
                    <div style={{ ...th, paddingLeft: 18 }}>{t("leadDetail.items.col.product")}</div>
                    <div style={th}>{t("leadDetail.items.col.size")}</div>
                    <div style={th}>{t("leadDetail.items.col.qty")}</div>
                    <div style={th}>{t("leadDetail.items.col.design")}</div>
                    <div style={th}>{t("leadDetail.items.col.quoted")}</div>
                  </div>
                  {lead.items.length === 0 ? (
                    <div style={{ borderTop: "1px solid #EEF2EA", padding: "11px 18px", color: "#6B7A66" }}>{t("leadDetail.items.empty")}</div>
                  ) : (
                    lead.items.map((item, i) => (
                      <div key={i} style={{ display: "grid", gridTemplateColumns: VIEW_COLS, borderTop: "1px solid #EEF2EA", alignItems: "center" }}>
                        <div style={{ padding: "11px 18px", fontWeight: 600, overflowWrap: "anywhere" }}>{productText(item) || "—"}</div>
                        <div style={{ padding: "11px 12px" }}>{item.size ? sizeText(item.size) : "—"}</div>
                        <div style={{ padding: "11px 12px" }}>{qtyCell(item, lang)}</div>
                        <div style={{ padding: "11px 12px" }}>{designText(item, t)}</div>
                        <div style={{ padding: "11px 12px", fontVariantNumeric: "tabular-nums" }}>{quotedPriceText(extras.quotedPrices[i])}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ overflowX: "auto" }}>
                  <div style={{ minWidth: 640, fontSize: 13 }}>
                    <div style={{ display: "grid", gridTemplateColumns: EDIT_COLS, background: "#F8FAF6" }}>
                      <div style={{ ...th, paddingLeft: 18 }}>{t("leadDetail.items.col.product")}</div>
                      <div style={th}>{t("leadDetail.items.col.size")}</div>
                      <div style={th}>{t("leadDetail.items.col.qty")}</div>
                      <div style={th}>{t("leadDetail.items.col.unit")}</div>
                      <div style={th}>{t("leadDetail.items.col.design")}</div>
                      <div />
                    </div>
                    {rows.map((row, i) => {
                      const n = i + 1;
                      return (
                        <div key={row.key} style={{ display: "grid", gridTemplateColumns: EDIT_COLS, gap: 8, borderTop: "1px solid #EEF2EA", alignItems: "center", padding: "8px 12px 8px 18px" }}>
                          <input
                            value={row.product}
                            maxLength={200}
                            onChange={(e) => setRow(row.key, { product: e.target.value })}
                            aria-label={`${t("leadDetail.items.col.product")} ${n}`}
                            style={control}
                          />
                          <input
                            value={row.size}
                            maxLength={100}
                            onChange={(e) => setRow(row.key, { size: e.target.value })}
                            aria-label={`${t("leadDetail.items.col.size")} ${n}`}
                            style={control}
                          />
                          <input
                            value={row.qty}
                            inputMode="decimal"
                            onChange={(e) => setRow(row.key, { qty: e.target.value })}
                            aria-label={`${t("leadDetail.items.col.qty")} ${n}`}
                            style={control}
                          />
                          <select
                            value={row.qtyUnit}
                            onChange={(e) => setRow(row.key, { qtyUnit: e.target.value as ItemRow["qtyUnit"] })}
                            aria-label={`${t("leadDetail.items.col.unit")} ${n}`}
                            style={control}
                          >
                            <option value="rim">rim</option>
                            <option value="pcs">pcs</option>
                          </select>
                          <select
                            value={row.design}
                            onChange={(e) => setRow(row.key, { design: e.target.value as ItemRow["design"] })}
                            aria-label={`${t("leadDetail.items.col.design")} ${n}`}
                            style={control}
                          >
                            <option value="">—</option>
                            <option value="yes">{t("leadDetail.items.design.yes")}</option>
                            <option value="no">{t("leadDetail.items.design.no")}</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
                            aria-label={`${t("leadDetail.items.remove")} ${n}`}
                            title={t("leadDetail.items.remove")}
                            style={{ ...outlineBtn, width: 32, padding: 0, color: "#5F6B5A" }}
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div style={{ padding: "12px 18px", borderTop: "1px solid #EEF2EA", display: "flex", flexDirection: "column", gap: 12 }}>
                  <button
                    type="button"
                    onClick={() => setRows((rs) => [...rs, blankRow()])}
                    disabled={rows.length >= MAX_ITEMS}
                    style={{ ...outlineBtn, alignSelf: "flex-start" }}
                  >
                    + {t("leadDetail.items.add")}
                  </button>
                  <div role="group" aria-label={t("leadDetail.items.brands")} style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
                    <span style={fieldLabel}>{t("leadDetail.items.brands")}</span>
                    {BRAND_SLUGS.map((slug) => (
                      <label key={slug} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                        <input type="checkbox" checked={brands.includes(slug)} onChange={(e) => toggleBrand(slug, e.target.checked)} />
                        {t(BRAND_TAG[slug].labelKey)}
                      </label>
                    ))}
                  </div>
                  <div style={{ fontSize: 12, color: "#5F6B5A" }}>{t("leadDetail.items.lockHint")}</div>
                  {itemsError && <div role="alert" style={{ fontSize: 13, color: "#B91C1C" }}>{itemsError}</div>}
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button type="button" onClick={() => setEditing(false)} disabled={pending} style={outlineBtn}>
                      {t("leadDetail.items.cancel")}
                    </button>
                    <button type="button" onClick={saveItems} disabled={pending} style={primaryBtn}>
                      {t("leadDetail.items.save")}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* The AI's proof for Won / Lost: the customer's own words. Hidden for marketing (stripped). */}
          {showProof && (
            <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
              <h2 style={cardTitle}>
                {lead.status === "won" ? t("leadDetail.proofTitleWon") : t("leadDetail.proofTitleLost")}
                {lead.status === "lost" && lead.lostReason ? ` · ${t(`lostReason.${lead.lostReason}` as TKey)}` : ""}
              </h2>
              <blockquote
                style={{
                  margin: 0,
                  padding: "12px 14px",
                  background: lead.status === "won" ? "#F0F7E6" : "#FBEAEA",
                  borderRadius: 6,
                  fontSize: 14,
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                }}
              >
                “{lead.outcomeEvidence}”
              </blockquote>
              <span style={{ fontSize: 12, color: "#5F6B5A" }}>
                {t("leadDetail.proofBy")}
                {lead.closedAt && ` · ${fmt(lead.closedAt, DAY_TIME)}`}
                {proofHref && !readOnly && (
                  <>
                    {" · "}
                    <Link href={proofHref} style={{ color: "#445428" }}>{t("leadDetail.proofLink")}</Link>
                  </>
                )}
              </span>
              {!readOnly && <span style={{ fontSize: 12, color: "#5F6B5A" }}>{t("leadDetail.proofHint")}</span>}
            </div>
          )}
        </div>

        <div style={{ flex: "1 1 280px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
            <h2 style={cardTitle}>{t("leadDetail.info")}</h2>
            <InfoRow label={t("leadDetail.firstContact")} value={fmt(firstContact, WITH_TIME)} />
            <InfoRow label={t("leadDetail.sourceLabel")} value={source} />
            <InfoRow
              label={lead.status === "lost" ? t("leadDetail.lostOn") : t("leadDetail.wonOn")}
              value={closed && lead.closedAt ? fmt(lead.closedAt, WITH_TIME) : "—"}
            />
            <InfoRow label={t("leadDetail.closeTime")} value={extras.closingMinutes !== null ? formatWait(extras.closingMinutes, lang) : "—"} />
            <InfoRow
              label={t("leadDetail.poForm")}
              value={
                extras.poFormSentAt ? (
                  <span style={{ color: "#15803D", fontWeight: 600 }}>{t("leadDetail.poFormSent", { time: fmt(extras.poFormSentAt, DAY_TIME) })}</span>
                ) : (
                  "—"
                )
              }
            />
            <InfoRow
              label={t("leadDetail.previous")}
              value={
                previousLead ? (
                  <Link href={`/leads/${previousLead.id}`} style={{ color: "#445428", fontWeight: 600 }}>
                    {t(`leads.status.${previousLead.status}` as TKey)} · {fmt(previousLead.closedAt ?? previousLead.submittedAt)}
                  </Link>
                ) : (
                  "—"
                )
              }
            />
          </div>

          <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12, fontSize: 13 }}>
            <h2 style={cardTitle}>{t("leadDetail.history")}</h2>
            {events.length === 0 ? (
              <div style={{ color: "#6B7A66" }}>{t("leadDetail.noHistory")}</div>
            ) : (
              <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                {events.map((ev, i) => (
                  <li key={ev.id} style={{ display: "flex", gap: 10 }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        marginTop: 6,
                        borderRadius: "50%",
                        background: (ev.toStatus && ev.toStatus !== ev.fromStatus && EVENT_DOT[ev.toStatus]) || "#9AA79A",
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                      <span>{eventTitle(ev, i === 0, t)}</span>
                      <span style={{ fontSize: 11.5, color: "#5F6B5A", overflowWrap: "anywhere" }}>
                        {t(`leadDetail.actor.${ev.actor}` as TKey)} · {fmt(ev.createdAt, DAY_TIME)}
                        {ev.evidence && ` · ${truncate(ev.evidence, EVIDENCE_MAX)}`}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
