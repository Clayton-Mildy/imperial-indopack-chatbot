"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { resolveConversation, returnToAi, takeOverConversation } from "@/actions/conversationActions";
import { sendMessage } from "@/actions/sendActions";
import { BASE_PATH } from "@/lib/basePath";
import type { BrandSlug } from "@/lib/brands";
import { chatStatus, phoneLocal, priceCallsOf, sourceLabel, stampTime, toolLine, type StatusTone } from "@/lib/conversations/labels";
import { apiFileUrl } from "@/lib/format";
import { useLang, useT } from "@/lib/i18n/LangProvider";
import type { ConversationWithMessages, Message } from "@/types/api";
import { QuickSendBar } from "./QuickSendBar";

const ACCEPTED_TYPES = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".jpg", ".jpeg", ".png", ".webp"];
const ACCEPTED_MIME = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/jpeg",
  "image/png",
  "image/webp",
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/** The upload proxy answers with the API's envelope; the stored row, or null when the API refused it. */
async function uploadAttachment(conversationId: string, file: File): Promise<Message | null> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE_PATH}/api/upload-attachment?conversationId=${encodeURIComponent(conversationId)}`, {
    method: "POST",
    body: form,
  });
  const body = (await res.json().catch(() => null)) as { data?: Message | null } | null;
  return res.ok && body?.data?.id ? body.data : null;
}

const PILL_TONE: Record<StatusTone, { background: string; color: string }> = {
  team: { background: "#FEF3C7", color: "#92400E" },
  ai: { background: "#F1F5F1", color: "#3B4540" },
  resolved: { background: "#DCFCE7", color: "#15803D" },
};

const footerBtn: React.CSSProperties = {
  font: "inherit",
  fontSize: 12.5,
  fontWeight: 600,
  height: 32,
  padding: "0 12px",
  border: "1px solid #D5DECF",
  borderRadius: 6,
  background: "#ffffff",
  color: "#1F2421",
  cursor: "pointer",
};

// ─── Bubbles ─────────────────────────────────────────────────────────────────

const isPlaceholderBody = (body: string) => /^\[[^\]]*\]$/.test(body.trim());

function Attachment({ msg, background, border }: { msg: Message; background: string; border: string }) {
  const t = useT();
  const meta = msg.metadata ?? {};
  const mediaUrl = typeof meta.mediaUrl === "string" ? meta.mediaUrl : null;
  if (meta.attachmentType === "image" && mediaUrl) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={apiFileUrl(mediaUrl)}
          alt={t("conversations.chat.photoAlt")}
          style={{ maxWidth: "100%", maxHeight: 260, borderRadius: 8, display: "block", cursor: "pointer" }}
          onClick={() => window.open(apiFileUrl(mediaUrl), "_blank", "noopener")}
        />
        {/* The body is the photo's caption, or a placeholder like "[Foto]" when it had none. */}
        {msg.body && !isPlaceholderBody(msg.body) && (
          <div style={{ whiteSpace: "pre-wrap", padding: "8px 12px", borderRadius: 10, background, border }}>{msg.body}</div>
        )}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background, border, borderRadius: 10 }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5F6B5A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 500, overflowWrap: "anywhere" }}>{(typeof meta.filename === "string" && meta.filename) || msg.body}</div>
        <div style={{ fontSize: 11.5, marginTop: 2 }}>
          {/* mediaUrl is set when the file itself was stored; without it there is nothing to link to. */}
          {mediaUrl ? (
            <a href={apiFileUrl(mediaUrl)} target="_blank" rel="noopener noreferrer">
              {t("conversations.chat.openFile")}
            </a>
          ) : (
            <span style={{ color: "#5F6B5A" }}>
              {meta.attachmentType === "image" ? t("conversations.chat.imageSent") : t("conversations.chat.documentSent")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Bubble({ msg, now }: { msg: Message; now: Date }) {
  const t = useT();
  const lang = useLang();

  if (msg.role === "system_note") {
    return (
      <div id={`msg-${msg.id}`} style={{ alignSelf: "center", maxWidth: "85%", textAlign: "center", fontSize: 11.5, color: "#5F6B5A", background: "#E6EBE2", padding: "3px 10px", borderRadius: 9999 }}>
        {msg.body}
      </div>
    );
  }

  const isCustomer = msg.role === "user";
  const isStaff = !isCustomer && !!msg.senderName;
  const background = isCustomer ? "#DCEBC6" : isStaff ? "#F0F7E6" : "#ffffff";
  const border = isStaff ? "1px solid #C9D6BB" : "1px solid transparent";
  const radius = isCustomer ? "12px 12px 2px 12px" : "12px 12px 12px 2px";
  const source = isCustomer ? null : sourceLabel(msg.metadata, lang);
  const sender = isCustomer ? null : isStaff ? t("conversations.chat.staff", { name: msg.senderName ?? "" }) : t("conversations.chat.bot");
  const hasAttachment = !!msg.metadata?.attachmentType;

  return (
    <div
      id={`msg-${msg.id}`}
      style={{ alignSelf: isCustomer ? "flex-end" : "flex-start", maxWidth: "70%", display: "flex", flexDirection: "column", gap: 3, alignItems: isCustomer ? "flex-end" : "flex-start" }}
    >
      {sender && (
        <span style={{ fontSize: 11, color: isStaff ? "#586B34" : "#5F6B5A", fontWeight: isStaff ? 600 : 400 }}>
          {source ? `${sender} · ${source}` : sender}
        </span>
      )}
      {hasAttachment ? (
        <Attachment msg={msg} background={background} border={border} />
      ) : (
        <div style={{ background, border, padding: "8px 12px", borderRadius: radius, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{msg.body}</div>
      )}
      <span style={{ fontSize: 10.5, color: "#8A968A" }}>
        {stampTime(msg.createdAt, now, lang)}
        {/* Stored but never delivered: the provider refused the send. Without this the bubble looks
            delivered, which is how a silent outage looks like a working bot. */}
        {!isCustomer && (msg.status === "saved" || msg.status === "failed") && (
          <span style={{ color: "#B91C1C", fontWeight: 600, marginLeft: 6 }}>· {t("conversations.chat.notDelivered")}</span>
        )}
      </span>
    </div>
  );
}

function ToolLines({ msg }: { msg: Message }) {
  const lang = useLang();
  const calls = priceCallsOf(msg.metadata);
  return (
    <>
      {calls.map((c, i) => {
        const quoted = c.outcome === "quote";
        return (
          <div
            key={`${msg.id}-tool-${i}`}
            style={{
              alignSelf: "center",
              maxWidth: "90%",
              textAlign: "center",
              fontSize: 11.5,
              fontWeight: 600,
              padding: "3px 10px",
              borderRadius: 9999,
              color: quoted ? "#586B34" : "#92400E",
              background: quoted ? "#F5F8F2" : "#FEF3C7",
              border: quoted ? "1px dashed #88B44E" : "1px solid transparent",
            }}
          >
            {toolLine(c, lang)}
          </div>
        );
      })}
    </>
  );
}

// ─── Chat column ─────────────────────────────────────────────────────────────

/**
 * The middle column of Percakapan: who the customer is and who holds the chat, the bot's hand-off
 * banner, the thread (with the bot's price-tool lines), and — unless the chat is resolved — the
 * quick-send bar, the reply box and the return-to-AI / resolve footer.
 */
export function ChatPane({
  conversation: initial,
  name,
  business,
  leadId,
  staffName,
  brands,
  nearestProductId,
}: {
  conversation: ConversationWithMessages;
  name: string;
  business: string | null;
  leadId: string | null;
  /** The signed-in staff member, as the reply is labelled. */
  staffName: string;
  brands: BrandSlug[];
  nearestProductId: string | null;
}) {
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  const [conv, setConv] = useState(initial);
  const [messages, setMessages] = useState<Message[]>(initial.messages);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(messages.length);
  const isAtBottom = useRef(true);
  const now = new Date();

  const [reply, setReply] = useState("");
  const [pending, startTransition] = useTransition();
  const [sendingReply, setSendingReply] = useState(false);
  const [showResolveConfirm, setShowResolveConfirm] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sendingRef = useRef(false);

  // Scroll to the bottom on load, or to the message a #msg-<id> link points at (the lead page's
  // proof link). Mount only: the refresh must not yank the view back.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    const target = window.location.hash ? document.getElementById(window.location.hash.slice(1)) : null;
    if (target) target.scrollIntoView({ block: "center" });
  }, []);

  // Fresh props from the poll replace the local copy.
  useEffect(() => {
    setConv(initial);
    setMessages(initial.messages);
  }, [initial]);

  // Follow new messages only when the reader is already at the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (messages.length > prevMessageCountRef.current && isAtBottom.current) el.scrollTop = el.scrollHeight;
    prevMessageCountRef.current = messages.length;
  }, [messages]);

  const held = conv.status === "escalated" || conv.status === "needs_human";
  const status = chatStatus(conv.status, conv.assignedAgent);
  const pill = PILL_TONE[status.tone];
  const phone = conv.contact?.waId ? phoneLocal(conv.contact.waId) : null;
  const busy = pending || uploading || sendingReply;

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const ext = "." + (file.name.split(".").pop() ?? "").toLowerCase();
    if (!ACCEPTED_MIME.includes(file.type) && !ACCEPTED_TYPES.includes(ext)) return setError(t("conversations.reply.fileTypeUnsupported"));
    if (file.size > MAX_FILE_SIZE) return setError(t("conversations.reply.fileTooLarge"));
    setPendingFile(file);
  }

  // A poll may already have brought the row back before the send resolved.
  function append(msg: Message) {
    setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
  }

  async function handleSend() {
    // The ref, not only `busy`: a double click lands before the re-render that disables the button.
    if (sendingRef.current || busy || (!pendingFile && !reply.trim())) return;
    sendingRef.current = true;
    const body = reply.trim();
    setError(null);
    try {
      if (pendingFile) {
        setUploading(true);
        const msg = await uploadAttachment(conv.id, pendingFile).catch(() => null);
        setUploading(false);
        if (!msg) return setError(t("conversations.reply.uploadFailed"));
        setPendingFile(null);
        append(msg);
      }
      if (body) {
        setSendingReply(true);
        try {
          const msg = await sendMessage(conv.id, body, staffName);
          setReply("");
          if (msg) append(msg);
        } catch {
          return setError(t("conversations.reply.sendFailed"));
        } finally {
          setSendingReply(false);
        }
      }
      router.refresh();
    } finally {
      sendingRef.current = false;
    }
  }

  function runStatus(action: (id: string) => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await action(conv.id);
        router.refresh();
      } catch {
        setError(t("conversations.footer.failed"));
      }
    });
  }

  return (
    <section
      aria-label={t("conversations.chat.label", { name })}
      style={{ flex: "1 1 420px", minWidth: 0, display: "flex", flexDirection: "column", background: "#EEF2EA", overflow: "hidden" }}
    >
      <div
        style={{
          background: "#ffffff",
          borderBottom: "1px solid #E1E7DC",
          padding: "10px 18px",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <b style={{ fontSize: 14, overflowWrap: "anywhere" }}>{business ? `${name} · ${business}` : name}</b>
          <span style={{ fontSize: 12, color: "#5F6B5A" }}>
            {phone}
            {phone && leadId && " · "}
            {leadId && <Link href={`/leads/${leadId}`}>{t("conversations.chat.viewLead")}</Link>}
          </span>
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 9999, background: pill.background, color: pill.color }}>
          {t(status.key, status.vars)}
        </span>
      </div>

      {held && conv.escalationReason && (
        <div role="status" style={{ background: "#FFFBEB", borderBottom: "1px solid #F3DC94", padding: "10px 18px", fontSize: 12.5, color: "#78350F", lineHeight: 1.5, flexShrink: 0 }}>
          {/* Taken over before any bot hand-off: there is no hand-off time to give. */}
          <b>{conv.escalatedAt ? t("conversations.chat.handoff", { time: stampTime(conv.escalatedAt, now, lang) }) : t("conversations.chat.takenOver")}</b>
          {" · "}
          {t("conversations.chat.reason", { reason: conv.escalationReason })}
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          isAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
        }}
        style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8, fontSize: 13, lineHeight: 1.5, color: "#1F2421" }}
      >
        {messages.length === 0 ? (
          <div style={{ textAlign: "center", color: "#5F6B5A", paddingTop: 40 }}>{t("conversations.chat.noMessages")}</div>
        ) : (
          messages.map((msg) => (
            <MessageRow key={msg.id} msg={msg} now={now} />
          ))
        )}
      </div>

      {conv.status === "resolved" ? (
        <div style={{ background: "#ffffff", borderTop: "1px solid #E1E7DC", padding: "14px 18px", fontSize: 13, color: "#5F6B5A", textAlign: "center", flexShrink: 0 }}>
          {t("conversations.resolvedNote")}
        </div>
      ) : (
        <div style={{ background: "#ffffff", borderTop: "1px solid #E1E7DC", padding: "12px 18px", display: "flex", flexDirection: "column", gap: 10, flexShrink: 0 }}>
          <QuickSendBar conversationId={conv.id} brands={brands} nearestProductId={nearestProductId} />

          {!held && <div style={{ fontSize: 11.5, color: "#5F6B5A" }}>{t("conversations.reply.aiHint")}</div>}

          {pendingFile && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "#F8FAF6", border: "1px solid #E1E7DC", borderRadius: 6 }}>
              <span style={{ fontSize: 12, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{pendingFile.name}</span>
              <span style={{ fontSize: 11, color: "#5F6B5A" }}>{(pendingFile.size / 1024).toFixed(0)} KB</span>
              <button
                type="button"
                aria-label={t("conversations.reply.removeFile")}
                onClick={() => setPendingFile(null)}
                disabled={uploading}
                style={{ font: "inherit", background: "none", border: 0, color: "#5F6B5A", cursor: "pointer", padding: "0 4px" }}
              >
                ✕
              </button>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <label htmlFor="cv-reply" style={{ fontSize: 11.5, color: "#5F6B5A" }}>
                {t("conversations.reply.as", { name: staffName })}
              </label>
              <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
                <button
                  type="button"
                  title={t("conversations.reply.attach")}
                  aria-label={t("conversations.reply.attach")}
                  onClick={() => {
                    setError(null);
                    fileInputRef.current?.click();
                  }}
                  disabled={busy}
                  style={{ flexShrink: 0, width: 36, height: 38, background: "#ffffff", border: "1px solid #D5DECF", borderRadius: 6, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#5F6B5A" }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                </button>
                <input ref={fileInputRef} type="file" accept={ACCEPTED_TYPES.join(",")} style={{ display: "none" }} onChange={handleFileSelect} />
                <textarea
                  id="cv-reply"
                  rows={2}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder={t("conversations.reply.placeholder")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend();
                  }}
                  style={{ flex: 1, minWidth: 0, font: "inherit", fontSize: 13, padding: "8px 10px", border: "1px solid #D5DECF", borderRadius: 6, resize: "none", boxSizing: "border-box", color: "#1F2421" }}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={handleSend}
              disabled={busy || (!reply.trim() && !pendingFile)}
              style={{
                font: "inherit",
                fontSize: 13,
                fontWeight: 600,
                height: 38,
                padding: "0 16px",
                border: 0,
                borderRadius: 6,
                background: "#586B34",
                color: "#ffffff",
                cursor: "pointer",
                opacity: busy || (!reply.trim() && !pendingFile) ? 0.5 : 1,
              }}
            >
              {uploading ? t("conversations.reply.uploading") : sendingReply ? t("conversations.reply.sending") : t("conversations.reply.send")}
            </button>
          </div>

          {error && <div style={{ fontSize: 12, color: "#B91C1C" }}>{error}</div>}

          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
            {held ? (
              <button type="button" style={footerBtn} disabled={busy} onClick={() => runStatus(returnToAi)}>
                {t("conversations.footer.returnToAi")}
              </button>
            ) : (
              <button type="button" style={footerBtn} disabled={busy} onClick={() => runStatus(takeOverConversation)}>
                {t("conversations.footer.takeOver")}
              </button>
            )}
            <button type="button" style={footerBtn} disabled={busy} onClick={() => setShowResolveConfirm(true)}>
              {t("conversations.footer.resolve")}
            </button>
          </div>
        </div>
      )}

      {showResolveConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(31, 36, 33, 0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="cv-resolve-title" style={{ background: "#ffffff", borderRadius: 12, padding: 24, width: "100%", maxWidth: 400, boxShadow: "0 12px 32px rgba(31, 36, 33, 0.18)", color: "#1F2421" }}>
            <div id="cv-resolve-title" style={{ fontSize: 15, fontWeight: 700 }}>{t("conversations.confirm.title")}</div>
            <div style={{ fontSize: 13, color: "#3B4540", marginTop: 6, lineHeight: 1.5 }}>{t("conversations.confirm.body")}</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
              <button type="button" style={footerBtn} disabled={pending} onClick={() => setShowResolveConfirm(false)}>
                {t("conversations.confirm.cancel")}
              </button>
              <button
                type="button"
                style={{ ...footerBtn, border: 0, background: "#586B34", color: "#ffffff" }}
                disabled={pending}
                onClick={() => {
                  setShowResolveConfirm(false);
                  runStatus(resolveConversation);
                }}
              >
                {t("conversations.confirm.yes")}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/** A bot reply that ran hitung_harga gets one line per call right before it. */
function MessageRow({ msg, now }: { msg: Message; now: Date }) {
  return (
    <>
      {msg.role === "assistant" && !msg.senderName && <ToolLines msg={msg} />}
      <Bubble msg={msg} now={now} />
    </>
  );
}
