"use client";
import { BASE_PATH } from "@/lib/basePath";

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { ConversationWithMessages, Message, ContactProfile } from "@/types/api";
import { sendMessage } from "@/actions/sendActions";
import { takeOverConversation, returnToAi, resolveConversation } from "@/actions/conversationActions";
import { setContactAi } from "@/actions/contactActions";
import { markFollowUpDone } from "@/lib/api/conversations";
import { Toggle } from "@/components/Toggle";
import { useT, useLang } from "@/lib/i18n/LangProvider";
import { formatDate, type TKey } from "@/lib/i18n/core";

const ACCEPTED_TYPES = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".jpg", ".jpeg", ".png", ".webp"];
const ACCEPTED_MIME = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

async function uploadAttachment(conversationId: string, file: File): Promise<Message> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE_PATH}/api/upload-attachment?conversationId=${conversationId}`, {
    method: "POST",
    body: form,
  });
  return res.json();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatPhone(raw: string): string {
  const digits = raw.replace(/^\+/, "").replace(/\D/g, "");
  if (digits.startsWith("62") && digits.length >= 11) {
    const local = digits.slice(2);
    return `+62 ${local.slice(0, 3)}-${local.slice(3, 7)}-${local.slice(7)}`;
  }
  return raw.startsWith("+") ? raw : `+${digits}`;
}

function markConversationRead(id: string) {
  try {
    const stored = JSON.parse(localStorage.getItem("imperial_conv_read") ?? "{}");
    stored[id] = Date.now();
    localStorage.setItem("imperial_conv_read", JSON.stringify(stored));
  } catch {}
}

/** Our own /uploads files live on the API; a file sent from elsewhere (a Chakra-hosted catalogue) is stored as its full URL. */
function mediaHref(url: string): string {
  return /^https?:\/\//.test(url) ? url : `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:50070"}${url}`;
}

// ─── Bubble ───────────────────────────────────────────────────────────────────

function Bubble({ msg }: { msg: Message }) {
  const t = useT();
  const lang = useLang();
  if (msg.role === "system_note") {
    return (
      <div id={`msg-${msg.id}`} style={{ textAlign: "center", margin: "12px 0" }}>
        <span style={{ fontSize: 11, color: "#64748B", background: "#F1F5F9", padding: "3px 10px", borderRadius: 99 }}>
          {msg.body}
        </span>
      </div>
    );
  }

  const isRight = msg.role === "assistant";
  const isHumanSender = isRight && msg.senderName;

  function formatTime(iso: string) {
    return formatDate(iso, lang, { hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div id={`msg-${msg.id}`} style={{ display: "flex", justifyContent: isRight ? "flex-end" : "flex-start", marginBottom: 12 }}>
      <div style={{ maxWidth: "72%", display: "flex", flexDirection: "column", alignItems: isRight ? "flex-end" : "flex-start" }}>
        {isRight && (
          <span style={{ fontSize: 10, fontWeight: 700, color: isHumanSender ? "#64748B" : "#586B34", marginBottom: 3, letterSpacing: "0.06em" }}>
            {isHumanSender ? msg.senderName!.toUpperCase() : "AI"}
          </span>
        )}
        <div
          style={{
            padding: msg.metadata?.attachmentType ? 0 : "10px 14px",
            borderRadius: 8,
            fontSize: 13,
            lineHeight: 1.5,
            background: msg.metadata?.attachmentType ? "transparent" : isRight ? (isHumanSender ? "#F1F5F9" : "#EAF2DD") : "white",
            border: msg.metadata?.attachmentType ? "none" : `1px solid ${isRight ? (isHumanSender ? "#E2E8F0" : "#D5DECF") : "#E2E8F0"}`,
            color: "#0A0A0A",
          }}
        >
          {msg.metadata?.attachmentType === "image" && msg.metadata?.mediaUrl ? (
            <div>
              <img
                src={mediaHref(msg.metadata.mediaUrl as string)}
                alt={t("conversations.detail.photoAlt")}
                style={{ maxWidth: "100%", maxHeight: 320, borderRadius: 8, display: "block", cursor: "pointer", marginLeft: isRight ? "auto" : 0 }}
                onClick={() => window.open(mediaHref(msg.metadata!.mediaUrl as string), "_blank")}
              />
              {/* The body is the photo's caption, or a placeholder like "[Foto]" when it had none. */}
              {msg.body && !/^\[[^\]]*\]$/.test(msg.body.trim()) && (
                <div style={{ whiteSpace: "pre-wrap", marginTop: 4, padding: "8px 12px", borderRadius: 8, background: isRight ? (isHumanSender ? "#F1F5F9" : "#EAF2DD") : "white", border: `1px solid ${isRight ? (isHumanSender ? "#E2E8F0" : "#D5DECF") : "#E2E8F0"}` }}>
                  {msg.body}
                </div>
              )}
            </div>
          ) : msg.metadata?.attachmentType ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: isRight ? (isHumanSender ? "#F1F5F9" : "#EAF2DD") : "white", border: `1px solid ${isRight ? (isHumanSender ? "#E2E8F0" : "#D5DECF") : "#E2E8F0"}`, borderRadius: 8 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "#0A0A0A" }}>{(msg.metadata.filename as string) || msg.body}</div>
                <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>
                  {/* mediaUrl is set when the file itself was stored (inbound webhook or the
                      ChakraHQ history sync); without it there's nothing to link to. */}
                  {msg.metadata.mediaUrl ? (
                    <a
                      href={mediaHref(msg.metadata.mediaUrl as string)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "#445428", textDecoration: "none" }}
                    >
                      {t("conversations.detail.openFile")}
                    </a>
                  ) : msg.metadata.attachmentType === "image" ? (
                    t("conversations.detail.imageSent")
                  ) : (
                    t("conversations.detail.documentSent")
                  )}
                </div>
              </div>
            </div>
          ) : (
            <span style={{ whiteSpace: "pre-wrap" }}>{msg.body}</span>
          )}
        </div>
        <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 3 }}>
          {formatTime(msg.createdAt)}
          {/* Stored but never delivered — the provider refused the send. Without this the
              bubble is indistinguishable from a delivered one, which is how a silent
              outage looks like a working bot. */}
          {isRight && (msg.status === "saved" || msg.status === "failed") && (
            <span style={{ color: "#DC2626", fontWeight: 600, marginLeft: 6 }}>
              · {t("conversations.detail.notDelivered")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Client Component ────────────────────────────────────────────────────

export function ConversationDetailClient({
  conversation: initial,
  agentName,
  contactProfile: initialProfile,
  aiDefault,
}: {
  conversation: ConversationWithMessages;
  agentName: string;
  contactProfile?: ContactProfile | null;
  /** Global switch — what this contact follows when it has no override. */
  aiDefault: boolean;
}) {
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  const [conv, setConv] = useState(initial);
  const [messages, setMessages] = useState<Message[]>(initial.messages);

  const scrollRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(messages.length);
  const isAtBottom = useRef(true);

  // Mark as read when conversation is opened
  useEffect(() => { markConversationRead(initial.id); }, [initial.id]);

  // Scroll to bottom on initial load, or to the message a #msg-<id> link points at (the lead
  // page's proof link). Mount only: the 3 s refresh must not yank the view back.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    const target = window.location.hash ? document.getElementById(window.location.hash.slice(1)) : null;
    if (target) target.scrollIntoView({ block: "center" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync when server re-validates and passes fresh props
  useEffect(() => { setConv(initial); setMessages(initial.messages); }, [initial]);

  // Poll for new messages every 3 seconds when conversation is active
  useEffect(() => {
    const interval = setInterval(() => {
      router.refresh();
    }, 3000);
    return () => clearInterval(interval);
  }, [router]);
  const [reply, setReply] = useState("");
  const [pending, startTransition] = useTransition();
  const [showResolveConfirm, setShowResolveConfirm] = useState(false);

  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [profile, setProfile] = useState<ContactProfile | null | undefined>(initialProfile);

  // null = no override, so the contact follows the global default.
  const [contactAiOverride, setContactAiOverride] = useState<boolean | null>(conv.contact?.aiEnabled ?? null);
  const [aiTogglePending, startAiToggle] = useTransition();
  const [aiToggleError, setAiToggleError] = useState<string | null>(null);
  const contactAiOn = contactAiOverride ?? aiDefault;

  function handleToggleContactAi() {
    if (!conv.contactId) return;
    const next = !contactAiOn;
    const previous = contactAiOverride;
    setContactAiOverride(next); // optimistic
    setAiToggleError(null);
    startAiToggle(async () => {
      const result = await setContactAi(conv.contactId, next).catch(() => ({ ok: false, error: undefined }));
      if (!result.ok) {
        setContactAiOverride(previous);
        setAiToggleError(result.error ?? t("conversations.detail.saveFailed"));
      }
    });
  }

  // needs_human = agent took over (show reply box)
  // escalated = AI still handling but flagged for pickup (show "Ambil Alih" button)
  const isHumanHandling = conv.status === "needs_human";

  // Scroll to bottom only when a new message arrives and user was already at the bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (messages.length > prevMessageCountRef.current && isAtBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevMessageCountRef.current = messages.length;
  }, [messages]);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    setFileError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!ACCEPTED_MIME.includes(file.type) && !ACCEPTED_TYPES.includes(ext)) {
      setFileError(t("conversations.detail.fileTypeUnsupported"));
      e.target.value = "";
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setFileError(t("conversations.detail.fileTooLarge"));
      e.target.value = "";
      return;
    }
    setPendingFile(file);
    e.target.value = "";
  }

  async function handleSend() {
    if (!pendingFile && !reply.trim()) return;
    const body = reply.trim();
    setReply("");

    if (pendingFile) {
      const file = pendingFile;
      setPendingFile(null);
      setUploading(true);
      try {
        const msg = await uploadAttachment(conv.id, file);
        if (msg) setMessages((prev) => [...prev, msg]);
      } finally {
        setUploading(false);
      }
    }

    if (body) {
      startTransition(async () => {
        const msg = await sendMessage(conv.id, body, agentName);
        if (msg) setMessages((prev) => [...prev, msg]);
      });
    }
  }

  function handleTakeOver() {
    startTransition(async () => {
      await takeOverConversation(conv.id);
      router.refresh();
    });
  }

  function handleReturnToAi() {
    startTransition(async () => {
      await returnToAi(conv.id);
      router.refresh();
    });
  }

  function handleResolve() {
    startTransition(async () => {
      await resolveConversation(conv.id);
      router.refresh();
    });
  }

  const contactName =
    conv.contact?.displayName ?? conv.contact?.waId ?? t("conversations.customerFallback");

  return (
    <main style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", padding: 24 }}>
      <div style={{ display: "flex", gap: 16, flex: 1, overflow: "hidden" }}>
        {/* Chat column */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, overflow: "hidden" }}>
          {/* Escalation / takeover banner */}
          {conv.status === "escalated" && (
            <div style={{ display: "flex", gap: 12, padding: "14px 16px", background: "#FFFBEB", border: "1px solid #FEF3C7", borderRadius: 6, flexShrink: 0 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#B45309" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}>
                <path d="M10.3 3.7a2 2 0 0 1 3.4 0l8 13.3A2 2 0 0 1 20 20H4a2 2 0 0 1-1.7-3L10.3 3.7z"/>
                <line x1="12" y1="9" x2="12" y2="14"/><circle cx="12" cy="17" r=".7" fill="#B45309"/>
              </svg>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#B45309", marginBottom: 4 }}>{t("conversations.detail.escalatedBanner")}</div>
                {conv.escalationReason && (
                  <div style={{ fontSize: 12, color: "#92400E" }}>
                    <strong>{t("conversations.detail.reason")}</strong> {conv.escalationReason}
                  </div>
                )}
                {/* Without a date a hand-off from weeks ago reads as current. */}
                {conv.escalatedAt && (
                  <div style={{ fontSize: 11, color: "#B45309", marginTop: 3 }}>
                    {t("conversations.detail.since", { date: formatDate(conv.escalatedAt, lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Message thread */}
          <div style={{ flex: 1, background: "white", border: "1px solid #E2E8F0", borderRadius: 6, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div
              ref={scrollRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                isAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
              }}
              style={{ flex: 1, overflowY: "auto", padding: "16px" }}
            >
              {messages.length === 0 ? (
                <div style={{ textAlign: "center", color: "#94A3B8", fontSize: 13, paddingTop: 40 }}>
                  {t("conversations.detail.noMessages")}
                </div>
              ) : (
                messages.map((msg) => (
                  <Bubble
                    key={msg.id}
                    msg={msg}
                  />
                ))
              )}
            </div>

            {/* Bottom bar */}
            {isHumanHandling ? (
              <>
                <div style={{ borderTop: "1px solid #E2E8F0", padding: "8px 16px", background: "#F5F8F2", fontSize: 12, color: "#1F1F1F", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: "#586B34", display: "inline-block" }} />
                  {t("conversations.detail.replyingAs")} <strong style={{ marginLeft: 3 }}>{agentName}</strong>
                </div>
                {pendingFile && (
                  <div style={{ padding: "8px 16px", background: "#F8FAFC", borderTop: "1px solid #E2E8F0", display: "flex", alignItems: "center", gap: 8 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <span style={{ fontSize: 12, color: "#0A0A0A", flex: 1 }}>{pendingFile.name}</span>
                    <span style={{ fontSize: 11, color: "#94A3B8" }}>{(pendingFile.size / 1024).toFixed(0)} KB</span>
                    <button
                      onClick={() => setPendingFile(null)}
                      style={{ background: "transparent", border: "none", color: "#94A3B8", cursor: "pointer", padding: "0 4px", fontSize: 13, lineHeight: 1, display: "flex", alignItems: "center" }}
                    >
                      ✕
                    </button>
                  </div>
                )}
                {fileError && (
                  <div style={{ padding: "4px 16px", fontSize: 12, color: "#DC2626", borderTop: "1px solid #FEE2E2", background: "#FFF5F5" }}>{fileError}</div>
                )}
                <div style={{ padding: "14px 16px", borderTop: "1px solid #F1F5F9" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <button
                      onClick={() => { setFileError(null); fileInputRef.current?.click(); }}
                      title={t("conversations.detail.attachFile")}
                      style={{ flexShrink: 0, width: 36, height: 36, background: "white", border: "1px solid #CBD5E1", borderRadius: 6, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748B", marginTop: 0 }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                      </svg>
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp"
                      style={{ display: "none" }}
                      onChange={handleFileSelect}
                    />
                    <textarea
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      placeholder={t("conversations.detail.replyPlaceholder")}
                      rows={3}
                      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend(); }}
                      style={{ flex: 1, padding: "8px 12px", fontSize: 13, color: "#0A0A0A", border: "1px solid #CBD5E1", borderRadius: 6, resize: "none", outline: "none", fontFamily: "inherit", boxSizing: "border-box", minHeight: 72 }}
                    />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={handleReturnToAi}
                        disabled={pending || uploading}
                        style={{ background: "transparent", border: "none", color: "#445428", fontSize: 12, fontWeight: 500, cursor: "pointer", padding: 0 }}
                      >
                        {t("conversations.detail.returnToAi")}
                      </button>
                      <button
                        onClick={() => setShowResolveConfirm(true)}
                        disabled={pending || uploading}
                        style={{ height: 32, padding: "0 12px", background: "#F0FDF4", color: "#15803D", border: "1px solid #86EFAC", borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                      >
                        {t("conversations.detail.resolve")}
                      </button>
                    </div>
                    <button
                      onClick={handleSend}
                      disabled={pending || uploading || (!reply.trim() && !pendingFile)}
                      style={{ height: 36, padding: "0 16px", background: "#586B34", color: "white", border: "none", borderRadius: 4, fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: (!reply.trim() && !pendingFile) ? 0.5 : 1 }}
                    >
                      {uploading ? t("conversations.detail.uploading") : pending ? t("conversations.detail.sending") : t("conversations.detail.send")}
                    </button>
                  </div>
                </div>
              </>
            ) : conv.status === "resolved" ? (
              <div style={{ borderTop: "1px solid #E2E8F0", padding: "14px 16px", background: "#F8FAFC", fontSize: 13, color: "#64748B", textAlign: "center" }}>
                {t("conversations.detail.resolvedNote")}
              </div>
            ) : (
              <div style={{ borderTop: "1px solid #E2E8F0", padding: "14px 16px", background: "#F8FAFC" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 9999, background: "#EAF2DD", display: "flex", alignItems: "center", justifyContent: "center", color: "#586B34", flexShrink: 0 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>
                    </svg>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "#0A0A0A" }}>{t("conversations.detail.aiHandling")}</div>
                    <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>{t("conversations.detail.takeOverHint")}</div>
                  </div>
                  <button
                    onClick={handleTakeOver}
                    disabled={pending}
                    style={{ height: 36, padding: "0 14px", background: "white", color: "#1F1F1F", border: "1px solid #CBD5E1", borderRadius: 4, fontSize: 13, fontWeight: 500, cursor: "pointer", flexShrink: 0 }}
                  >
                    {t("conversations.detail.takeOver")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Contact info panel */}
        <div style={{ width: 280, flexShrink: 0, background: "white", border: "1px solid #E2E8F0", borderRadius: 6, padding: "20px", alignSelf: "flex-start" }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "#0A0A0A", margin: "0 0 16px" }}>{t("conversations.detail.contactInfo")}</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <InfoRow label={t("conversations.detail.name")} value={contactName} />
            {conv.contact?.waId && <InfoRow label="WhatsApp" value={formatPhone(conv.contact.waId)} mono />}
            {conv.contact?.firstSeen && (
              <InfoRow
                label={t("conversations.detail.firstSeen")}
                value={formatDate(conv.contact.firstSeen, lang, { day: "numeric", month: "long", year: "numeric" })}
              />
            )}
            {conv.contact?.lastSeen && (
              <InfoRow
                label={t("conversations.detail.lastActive")}
                value={formatDate(conv.contact.lastSeen, lang, { day: "numeric", month: "long", year: "numeric" })}
              />
            )}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div>
                <div style={{ fontSize: 13, color: "#0A0A0A", fontWeight: 500 }}>{t("conversations.detail.aiReplies")}</div>
                <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 1 }}>
                  {contactAiOverride === null ? t("conversations.detail.followsGlobal") : t("conversations.detail.contactSpecific")}
                </div>
              </div>
              <Toggle on={contactAiOn} onChange={handleToggleContactAi} disabled={aiTogglePending} />
            </div>
            {aiToggleError && <div style={{ fontSize: 11, color: "#DC2626" }}>{aiToggleError}</div>}
          </div>

          <hr style={{ margin: "16px 0", borderColor: "#E2E8F0", borderTopWidth: 1 }} />

          <h3 style={{ fontSize: 13, fontWeight: 600, color: "#0A0A0A", margin: "0 0 12px" }}>{t("conversations.colStatus")}</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: "#64748B" }}>{t("conversations.colStatus")}</span>
              <StatusBadge status={conv.status} />
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: "#64748B" }}>{t("conversations.detail.agent")}</span>
              <span style={{ fontSize: 13, color: conv.assignedAgent ? "#0A0A0A" : "#94A3B8", fontWeight: conv.assignedAgent ? 500 : 400 }}>
                {conv.assignedAgent ?? "—"}
              </span>
            </div>
          </div>

          {/* Follow-up notes from AI */}
          {conv.followUpNotes && (
            <>
              <hr style={{ margin: "16px 0", borderColor: "#E2E8F0", borderTopWidth: 1 }} />
              <div style={{ background: "#EDE9FE", borderRadius: 6, padding: "10px 12px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#7C3AED", marginBottom: 4 }}>{t("conversations.detail.followUpNeeded")}</div>
                <div style={{ fontSize: 12, color: "#4C1D95", lineHeight: 1.5 }}>{conv.followUpNotes}</div>
              </div>
            </>
          )}

          {/* Contact profile (CATAT) */}
          {profile && Object.keys(profile.profile ?? {}).length > 0 && (
            <>
              <hr style={{ margin: "16px 0", borderColor: "#E2E8F0", borderTopWidth: 1 }} />
              <h3 style={{ fontSize: 13, fontWeight: 600, color: "#0A0A0A", margin: "0 0 10px" }}>{t("conversations.detail.customerProfile")}</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {Object.entries(profile.profile ?? {}).map(([k, v]) => (
                  <div key={k} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      {k.replace(/_/g, " ")}
                    </span>
                    <span style={{ fontSize: 12, color: "#334155" }}>
                      {Array.isArray(v) ? (v as unknown[]).join(", ") : String(v)}
                    </span>
                  </div>
                ))}
              </div>
              {profile.followUpStatus === "needs_followup" && (
                <button
                  onClick={async () => {
                    await markFollowUpDone(conv.id);
                    setProfile((p) => p ? { ...p, followUpStatus: "done" } : p);
                    router.refresh();
                  }}
                  style={{
                    marginTop: 12, width: "100%", height: 32, background: "#F0FDF4", color: "#15803D",
                    border: "1px solid #BBF7D0", borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  {t("conversations.detail.markFollowUpDone")}
                </button>
              )}
              {profile.followUpStatus === "done" && (
                <div style={{ marginTop: 8, fontSize: 11, color: "#15803D", fontWeight: 500 }}>{t("conversations.detail.followUpDone")}</div>
              )}
            </>
          )}

          {/* Sales Intelligence panel */}
          {profile && (
            typeof profile.profile?.upsell_offered === 'boolean' ||
            typeof profile.profile?.upsell_accepted === 'boolean' ||
            typeof profile.profile?.crosssell_offered === 'boolean' ||
            typeof profile.profile?.crosssell_accepted === 'boolean'
          ) && (
            <>
              <hr style={{ margin: "16px 0", borderColor: "#E2E8F0", borderTopWidth: 1 }} />
              <h3 style={{ fontSize: 13, fontWeight: 600, color: "#0A0A0A", margin: "0 0 10px" }}>{t("conversations.detail.salesIntelligence")}</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  { label: t("conversations.detail.upsellOffered"), value: profile?.profile?.upsell_offered },
                  { label: t("conversations.detail.upsellAccepted"), value: profile?.profile?.upsell_accepted },
                  { label: t("conversations.detail.crosssellOffered"), value: profile?.profile?.crosssell_offered },
                  { label: t("conversations.detail.crosssellAccepted"), value: profile?.profile?.crosssell_accepted },
                ].map(({ label, value }) => (
                  <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 12, color: "#64748B" }}>{label}</span>
                    <span style={{ fontSize: 13, fontWeight: 500, color: value === true ? "#15803D" : value === false ? "#5F6B5A" : "#94A3B8" }}>
                      {value === true ? t("conversations.detail.yes") : value === false ? t("conversations.detail.no") : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Resolve confirmation modal */}
      {showResolveConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
          <div style={{ background: "white", borderRadius: 8, padding: 28, width: 380, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 999, background: "#F0FDF4", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#15803D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#0A0A0A" }}>{t("conversations.detail.confirmTitle")}</div>
                <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>{t("conversations.detail.confirmBody")}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
              <button
                onClick={() => setShowResolveConfirm(false)}
                disabled={pending}
                style={{ height: 36, padding: "0 16px", background: "white", color: "#1F1F1F", border: "1px solid #CBD5E1", borderRadius: 4, fontSize: 13, fontWeight: 500, cursor: "pointer" }}
              >
                {t("conversations.detail.cancel")}
              </button>
              <button
                onClick={() => { setShowResolveConfirm(false); handleResolve(); }}
                disabled={pending}
                style={{ height: 36, padding: "0 16px", background: "#15803D", color: "white", border: "none", borderRadius: 4, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                {t("conversations.detail.confirmYes")}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#64748B", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: "#0A0A0A", fontFamily: mono ? "JetBrains Mono, monospace" : undefined }}>{value}</div>
    </div>
  );
}

const STATUS_MAP: Record<string, { label: TKey; style: React.CSSProperties }> = {
  active: { label: "conversations.status.active", style: { background: "#F1F5F9", color: "#334155" } },
  escalated: { label: "conversations.status.escalated", style: { background: "#FEF3C7", color: "#B45309" } },
  resolved: { label: "conversations.status.resolved", style: { background: "#DCFCE7", color: "#15803D" } },
  needs_human: { label: "conversations.status.needsHuman", style: { background: "#EFF6FF", color: "#1D4ED8" } },
};

function StatusBadge({ status }: { status: string }) {
  const t = useT();
  const s = STATUS_MAP[status] ?? STATUS_MAP.active;
  return (
    <span style={{ display: "inline-flex", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, ...s.style }}>
      {t(s.label)}
    </span>
  );
}
