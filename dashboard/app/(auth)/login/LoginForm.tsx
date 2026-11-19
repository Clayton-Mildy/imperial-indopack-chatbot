"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/LangProvider";
import { BrandMark } from "@/components/layout/BrandMark";

export function LoginForm() {
  const router = useRouter();
  const t = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (result?.error) {
        setError(t("login.invalid"));
      } else {
        router.push("/conversations");
      }
    } catch {
      setError(t("login.error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: "#F2F5EF" }}
    >
      <div
        style={{
          width: 400,
          background: "white",
          borderRadius: 6,
          boxShadow: "0 1px 3px rgba(0,0,0,0.10), 0 1px 2px rgba(0,0,0,0.06)",
          padding: 32,
        }}
      >
        {/* Brand: the same "S" mark and name as the sidebar header */}
        <div className="flex items-center" style={{ marginBottom: 20, gap: 10 }}>
          <BrandMark />
        </div>

        <h1
          style={{
            fontSize: 20,
            fontWeight: 600,
            color: "#1F2421",
            margin: "0 0 4px",
            letterSpacing: "-0.01em",
          }}
        >
          {t("login.title")}
        </h1>
        <p style={{ fontSize: 13, color: "#64748B", margin: 0 }}>
          {t("login.subtitle")}
        </p>

        <hr style={{ margin: "20px 0", borderColor: "#E1E7DC", borderTopWidth: 1 }} />

        <form onSubmit={handleSubmit}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 20 }}>
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#1F1F1F",
                  marginBottom: 5,
                  letterSpacing: "0.02em",
                  textTransform: "uppercase",
                }}
              >
                {t("login.email")}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nama@imperial-indopack.example.com"
                required
                style={{
                  width: "100%",
                  height: 36,
                  padding: "0 10px",
                  fontSize: 13,
                  color: "#0A0A0A",
                  background: "white",
                  border: "1px solid #CBD5E1",
                  borderRadius: 4,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#1F1F1F",
                  marginBottom: 5,
                  letterSpacing: "0.02em",
                  textTransform: "uppercase",
                }}
              >
                {t("login.password")}
              </label>
              <div style={{ position: "relative" }}>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  style={{
                    width: "100%",
                    height: 36,
                    padding: "0 36px 0 10px",
                    fontSize: 13,
                    color: "#0A0A0A",
                    background: "white",
                    border: "1px solid #CBD5E1",
                    borderRadius: 4,
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: "absolute",
                    right: 4,
                    top: 4,
                    width: 28,
                    height: 28,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: "#64748B",
                    borderRadius: 4,
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {error && (
            <p style={{ fontSize: 12, color: "#B91C1C", marginBottom: 12, marginTop: -8 }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              height: 44,
              // primary-600 while loading, at full opacity: white on a lighter green at 0.7 was unreadable.
              background: loading ? "#6C9442" : "#586B34",
              color: "white",
              border: "none",
              borderRadius: 4,
              fontSize: 13,
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            {loading ? t("login.loading") : t("login.submit")}
          </button>
        </form>

        <p
          style={{
            fontSize: 11,
            color: "#64748B",
            textAlign: "center",
            marginTop: 16,
            marginBottom: 0,
          }}
        >
          {t("login.forgot")}
        </p>
      </div>
    </div>
  );
}
