"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import type { PhoneNumber } from "@/types/api";
import { useT } from "@/lib/i18n/LangProvider";
import { sendChatMessage } from "@/actions/testPromptActions";
import type { ChatMessage, ChatResponse } from "@/actions/testPromptActions";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EscalationMessage {
  type: "escalation";
  reason: string;
}

type ConversationEntry =
  | { type: "customer"; content: string; imageUrl?: string }
  | { type: "bot"; content: string }
  | EscalationMessage;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toHistoryMessages(entries: ConversationEntry[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const e of entries) {
    if (e.type === "customer") out.push({ role: "customer", content: e.content });
    else if (e.type === "bot") out.push({ role: "bot", content: e.content });
    // escalation entries are UI-only; skip them
  }
  return out;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ConfidenceBadge({ confidence }: { confidence: "high" | "low" }) {
  const t = useT();
  const isHigh = confidence === "high";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 12,
        fontSize: 11,
        fontWeight: 600,
        background: isHigh ? "#DCFCE7" : "#FEF3C7",
        color: isHigh ? "#15803D" : "#92400E",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}
    >
      {isHigh ? t("testPrompt.confHigh") : t("testPrompt.confLow")}
    </span>
  );
}

function CollapsibleSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          fontSize: 12,
          fontWeight: 600,
          color: "#475569",
          cursor: "pointer",
          background: "transparent",
          border: "none",
          padding: 0,
          width: "100%",
          textAlign: "left",
          marginBottom: open ? 8 : 0,
        }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            transform: open ? "rotate(0deg)" : "rotate(-90deg)",
            transition: "transform 0.15s",
            flexShrink: 0,
          }}
        >
          <polyline points="6,9 12,15 18,9" />
        </svg>
        {title}
      </button>
      {open && children}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface TestPromptClientProps {
  initialNumbers: PhoneNumber[];
}

export function TestPromptClient({ initialNumbers }: TestPromptClientProps) {
  const t = useT();
  const [selectedNumberId, setSelectedNumberId] = useState<string>(
    initialNumbers[0]?.id ?? ""
  );

  const [conversation, setConversation] = useState<ConversationEntry[]>([]);
  const [lastAIInfo, setLastAIInfo] = useState<ChatResponse | null>(null);
  const [input, setInput] = useState("");
  const [pendingImage, setPendingImage] = useState<{ dataUrl: string; base64: string; mimeType: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom whenever conversation changes
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation, isPending]);

  function resetChat() {
    setConversation([]);
    setLastAIInfo(null);
    setError(null);
    setInput("");
    setPendingImage(null);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      // dataUrl = "data:image/jpeg;base64,XXXX"
      const [header, base64] = dataUrl.split(",");
      const mimeType = header.split(":")[1].split(";")[0];
      setPendingImage({ dataUrl, base64, mimeType });
    };
    reader.readAsDataURL(file);
    // reset so same file can be re-selected
    e.target.value = "";
  }

  function handleReset() {
    resetChat();
    inputRef.current?.focus();
  }

  // ── Send message ──────────────────────────────────────────────────────────
  function handleSend(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmed = input.trim();
    if ((!trimmed && !pendingImage) || isPending || !selectedNumberId) return;

    const customerEntry: ConversationEntry = {
      type: "customer",
      content: trimmed,
      imageUrl: pendingImage?.dataUrl,
    };
    const prevConversation = conversation;
    const nextConversation = [...conversation, customerEntry];
    setConversation(nextConversation);
    setInput("");
    const imageToSend = pendingImage;
    setPendingImage(null);
    setError(null);

    const pastHistory = toHistoryMessages(prevConversation);

    startTransition(async () => {
      const res = await sendChatMessage(
        selectedNumberId,
        pastHistory,
        trimmed,
        imageToSend ? { base64: imageToSend.base64, mimeType: imageToSend.mimeType } : undefined
      );
      if (res.ok) {
        const { data } = res;
        setLastAIInfo(data);
        if (data.escalate) {
          setConversation((prev) => [
            ...prev,
            { type: "escalation", reason: data.reason ?? t("testPrompt.escalatedDefault") },
          ]);
        } else if (data.reply) {
          setConversation((prev) => [
            ...prev,
            { type: "bot", content: data.reply! },
          ]);
        }
      } else {
        setError(res.error);
        setConversation(prevConversation);
      }
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const noNumbers = initialNumbers.length === 0;
  const inputDisabled = isPending || noNumbers || !selectedNumberId;
  const canSend = !inputDisabled && (input.trim().length > 0 || pendingImage !== null);

  return (
    <main style={{ flex: 1, overflowY: "auto", padding: 32 }}>
      <h1
        style={{
          margin: "0 0 20px",
          fontSize: 22,
          fontWeight: 700,
          color: "#0A0A0A",
        }}
      >
        {t("testPrompt.title")}
      </h1>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        {/* ── Left column: Chat window ─────────────────────────────────── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              background: "white",
              border: "1px solid #E2E8F0",
              borderRadius: 6,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Chat header */}
            <div
              style={{
                padding: "14px 16px",
                borderBottom: "1px solid #E2E8F0",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 600, color: "#0A0A0A" }}>
                {t("testPrompt.chatTitle")}
              </span>
              <button
                onClick={handleReset}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#445428",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: "4px 8px",
                  borderRadius: 4,
                }}
              >
                {t("testPrompt.reset")}
              </button>
            </div>

            {/* ── Phone number selector ───────────────────────────────────── */}
            <div
              style={{
                padding: "10px 16px",
                borderBottom: "1px solid #E2E8F0",
                background: "#F8FAFC",
              }}
            >
              {noNumbers ? (
                <div style={{ fontSize: 13, color: "#94A3B8" }}>
                  {t("testPrompt.noNumbersHint")}
                </div>
              ) : (
                <select
                  value={selectedNumberId}
                  onChange={(e) => {
                    setSelectedNumberId(e.target.value);
                    resetChat();
                  }}
                  style={{
                    width: "100%",
                    height: 34,
                    padding: "0 10px",
                    fontSize: 13,
                    color: "#0A0A0A",
                    background: "white",
                    border: "1px solid #CBD5E1",
                    borderRadius: 4,
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  {initialNumbers.map((num) => (
                    <option key={num.id} value={num.id}>
                      {num.label ? `${num.label} — ` : ""}
                      {num.number}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Chat area */}
            <div
              style={{
                height: 500,
                overflowY: "auto",
                padding: 16,
                background: "#F1F5F9",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {conversation.length === 0 && !isPending ? (
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 13,
                    color: "#94A3B8",
                    fontStyle: "italic",
                  }}
                >
                  {noNumbers
                    ? t("testPrompt.emptyNoNumbers")
                    : t("testPrompt.emptyStart")}
                </div>
              ) : (
                conversation.map((entry, i) => {
                  if (entry.type === "customer") {
                    return (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          justifyContent: "flex-start",
                        }}
                      >
                        <div
                          style={{
                            background: "#FFFFFF",
                            color: "#0A0A0A",
                            borderRadius: 6,
                            padding: "8px 12px",
                            fontSize: 13,
                            maxWidth: "70%",
                            lineHeight: 1.5,
                            whiteSpace: "pre-wrap",
                            boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
                          }}
                        >
                          {entry.imageUrl && (
                            <img
                              src={entry.imageUrl}
                              alt={t("testPrompt.attachmentAlt")}
                              style={{
                                display: "block",
                                maxWidth: "100%",
                                maxHeight: 200,
                                borderRadius: 4,
                                marginBottom: entry.content ? 6 : 0,
                                objectFit: "cover",
                              }}
                            />
                          )}
                          {entry.content}
                        </div>
                      </div>
                    );
                  }

                  if (entry.type === "bot") {
                    return (
                      <div
                        key={i}
                        style={{ display: "flex", justifyContent: "flex-end" }}
                      >
                        <div style={{ maxWidth: "70%" }}>
                          <div
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              color: "#586B34",
                              textAlign: "right",
                              marginBottom: 3,
                              letterSpacing: "0.04em",
                            }}
                          >
                            AI
                          </div>
                          <div
                            style={{
                              background: "#EAF2DD",
                              color: "#0A0A0A",
                              borderRadius: 6,
                              padding: "8px 12px",
                              fontSize: 13,
                              lineHeight: 1.5,
                              whiteSpace: "pre-wrap",
                              boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
                            }}
                          >
                            {entry.content}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  // escalation
                  return (
                    <div
                      key={i}
                      style={{ display: "flex", justifyContent: "center" }}
                    >
                      <div
                        style={{
                          background: "#FFFBEB",
                          border: "1px solid #FCD34D",
                          borderRadius: 6,
                          padding: "8px 14px",
                          fontSize: 12,
                          fontWeight: 600,
                          color: "#92400E",
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                          <line x1="12" y1="9" x2="12" y2="13" />
                          <line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>
                        {t("testPrompt.escalated", { reason: entry.reason })}
                      </div>
                    </div>
                  );
                })
              )}

              {/* Loading indicator */}
              {isPending && (
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <div style={{ maxWidth: "70%" }}>
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: "#586B34",
                        textAlign: "right",
                        marginBottom: 3,
                        letterSpacing: "0.04em",
                      }}
                    >
                      AI
                    </div>
                    <div
                      style={{
                        background: "#EAF2DD",
                        borderRadius: 6,
                        padding: "10px 14px",
                        display: "flex",
                        gap: 4,
                        alignItems: "center",
                      }}
                    >
                      {[0, 1, 2].map((d) => (
                        <div
                          key={d}
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: "#586B34",
                            opacity: 0.5,
                            animation: `bounce 1.2s ease-in-out ${d * 0.2}s infinite`,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* Error banner */}
            {error && (
              <div
                style={{
                  background: "#FEF2F2",
                  borderTop: "1px solid #FECACA",
                  padding: "10px 16px",
                  fontSize: 12,
                  color: "#DC2626",
                  fontWeight: 500,
                }}
              >
                {error}
              </div>
            )}

            {/* Image preview strip */}
            {pendingImage && (
              <div
                style={{
                  padding: "8px 12px",
                  borderTop: "1px solid #E2E8F0",
                  background: "#F8FAFC",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <div style={{ position: "relative", display: "inline-flex" }}>
                  <img
                    src={pendingImage.dataUrl}
                    alt={t("common.previewAlt")}
                    style={{
                      width: 56,
                      height: 56,
                      objectFit: "cover",
                      borderRadius: 4,
                      border: "1px solid #CBD5E1",
                    }}
                  />
                  <button
                    onClick={() => setPendingImage(null)}
                    style={{
                      position: "absolute",
                      top: -6,
                      right: -6,
                      width: 18,
                      height: 18,
                      borderRadius: "50%",
                      background: "#64748B",
                      color: "white",
                      border: "none",
                      cursor: "pointer",
                      fontSize: 10,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </div>
                <span style={{ fontSize: 11, color: "#64748B" }}>
                  {t("testPrompt.photoAttached")}
                </span>
              </div>
            )}

            {/* Input area */}
            <div
              style={{
                padding: "10px 12px",
                borderTop: "1px solid #E2E8F0",
                display: "flex",
                gap: 8,
                alignItems: "center",
                background: "white",
              }}
            >
              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleFileSelect}
              />

              {/* Attach button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={inputDisabled}
                title={t("testPrompt.attachPhoto")}
                style={{
                  width: 36,
                  height: 36,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "transparent",
                  border: "1px solid #CBD5E1",
                  borderRadius: 4,
                  cursor: inputDisabled ? "not-allowed" : "pointer",
                  color: inputDisabled ? "#CBD5E1" : "#64748B",
                  transition: "color 0.1s, border-color 0.1s",
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21,15 16,10 5,21" />
                </svg>
              </button>

              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={inputDisabled}
                placeholder={
                  noNumbers
                    ? t("testPrompt.phNoNumbers")
                    : pendingImage
                    ? t("testPrompt.phCaption")
                    : t("testPrompt.phMessage")
                }
                style={{
                  flex: 1,
                  height: 36,
                  padding: "0 12px",
                  fontSize: 13,
                  color: "#0A0A0A",
                  background: inputDisabled ? "#F8FAFC" : "white",
                  border: "1px solid #CBD5E1",
                  borderRadius: 4,
                  outline: "none",
                  fontFamily: "inherit",
                }}
              />
              <button
                onClick={() => handleSend()}
                disabled={!canSend}
                style={{
                  height: 36,
                  padding: "0 16px",
                  background: !canSend ? "#F1F5F9" : "#586B34",
                  color: !canSend ? "#94A3B8" : "white",
                  border: "none",
                  borderRadius: 4,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: !canSend ? "not-allowed" : "pointer",
                  whiteSpace: "nowrap",
                  transition: "background 0.1s, color 0.1s",
                }}
              >
                {isPending ? "..." : t("testPrompt.send")}
              </button>
            </div>
          </div>
        </div>

        {/* ── Right column: Info panel ──────────────────────────────────── */}
        <div
          style={{
            width: 280,
            flexShrink: 0,
            background: "white",
            border: "1px solid #E2E8F0",
            borderRadius: 6,
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "#64748B",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            {t("testPrompt.lastResponse")}
          </div>

          {/* Confidence */}
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#94A3B8",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                marginBottom: 5,
              }}
            >
              {t("testPrompt.confidence")}
            </div>
            {lastAIInfo ? (
              <ConfidenceBadge confidence={lastAIInfo.confidence} />
            ) : (
              <span style={{ fontSize: 13, color: "#CBD5E1" }}>—</span>
            )}
          </div>

          {/* Topics */}
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#94A3B8",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                marginBottom: 5,
              }}
            >
              {t("testPrompt.topics")}
            </div>
            {lastAIInfo && lastAIInfo.topics.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {lastAIInfo.topics.map((t, i) => (
                  <span
                    key={i}
                    style={{
                      background: "#F1F5F9",
                      color: "#475569",
                      borderRadius: 4,
                      padding: "2px 7px",
                      fontSize: 11,
                      fontWeight: 500,
                    }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            ) : (
              <span style={{ fontSize: 13, color: "#CBD5E1" }}>—</span>
            )}
          </div>

          {/* System prompt collapsible */}
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#94A3B8",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                marginBottom: 5,
              }}
            >
              {t("testPrompt.catalogContext")}
            </div>
            {lastAIInfo ? (
              <CollapsibleSection title={t("testPrompt.systemPrompt")}>
                <div
                  style={{
                    background: "#1E293B",
                    borderRadius: 4,
                    padding: "10px 12px",
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: 10,
                    color: "#94A3B8",
                    lineHeight: 1.6,
                    overflowX: "auto",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    maxHeight: 300,
                    overflowY: "auto",
                  }}
                >
                  {lastAIInfo.systemPrompt}
                </div>
              </CollapsibleSection>
            ) : (
              <span style={{ fontSize: 13, color: "#CBD5E1" }}>—</span>
            )}
          </div>
        </div>
      </div>

      {/* Bounce animation keyframes */}
      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0); }
          40% { transform: scale(1); }
        }
      `}</style>
    </main>
  );
}
