import { auth, signOut } from "@/lib/auth";
import { roleLabel } from "@/lib/roles";
import { Header } from "@/components/layout/Header";
import { apiFetch } from "@/lib/api/client";
import type { PhoneNumber, PromptSection } from "@/types/api";
import { getNumbers } from "@/lib/api/numbers";
import { PromptSettingsClient } from "./PromptSettingsClient";
import { getT } from "@/lib/i18n";
import { LanguageSelect } from "./LanguageSelect";
import { ChangePasswordClient } from "./ChangePasswordClient";
import { AiToggleClient } from "./AiToggleClient";
import { ChakraSyncClient } from "./ChakraSyncClient";
import { LeadSettingsClient } from "./LeadSettingsClient";
import { sessionRole } from "@/lib/session";
import { getLeadReopenDays, getLeadSilenceDays } from "@/lib/api/settings";
import { getAiDefault, getChakraSyncStatus } from "@/actions/settingsActions";

async function getDefaultSections(): Promise<PromptSection[]> {
  try {
    const envelope = await apiFetch<PromptSection[]>("/settings/prompt-defaults");
    return envelope.data ?? [];
  } catch {
    return [];
  }
}

export default async function SettingsPage() {
  const session = await auth();
  const t = await getT();
  const [numbers, promptDefaults, aiEnabled, chakraSync] = await Promise.all([
    getNumbers().catch(() => [] as PhoneNumber[]),
    getDefaultSections(),
    getAiDefault(),
    getChakraSyncStatus(),
  ]);

  const isAdmin = (await sessionRole()) === "admin";
  const [leadReopenDays, leadSilenceDays]: [number | null, number | null] = isAdmin
    ? await Promise.all([getLeadReopenDays().catch(() => null), getLeadSilenceDays().catch(() => null)])
    : [null, null];

  const user = {
    name: session?.user?.name ?? "—",
    email: session?.user?.email ?? "—",
    role: (session?.user as { role?: string } | undefined)?.role ?? "agent",
  };

  return (
    <>
      <Header title={t("settings.title")} />
      <main style={{ flex: 1, overflowY: "auto", padding: 32 }}>
        <div style={{ maxWidth: 720 }}>
          <h1 style={{ margin: "0 0 24px", fontSize: 22, fontWeight: 700, color: "#0A0A0A" }}>{t("settings.title")}</h1>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Profil Saya */}
            <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 6, padding: "20px 24px" }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, color: "#0A0A0A", margin: 0, paddingBottom: 14, borderBottom: "1px solid #F1F5F9" }}>
                {t("settings.profile.title")}
              </h3>
              <div style={{ paddingTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
                <ProfileRow label={t("settings.profile.name")} value={user.name} />
                <ProfileRow label={t("settings.profile.email")} value={user.email} mono />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, color: "#64748B" }}>{t("settings.profile.role")}</span>
                  <span
                    style={{
                      display: "inline-flex",
                      padding: "2px 8px",
                      background: user.role === "admin" ? "#EAF2DD" : "#F1F5F9",
                      color: user.role === "admin" ? "#3E4C24" : "#334155",
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    {roleLabel(user.role, t)}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, color: "#64748B" }}>{t("settings.profile.language")}</span>
                  <LanguageSelect />
                </div>
              </div>
            </div>

            {/* Sakelar balasan otomatis (global) */}
            <AiToggleClient initialAiEnabled={aiEnabled} />

            {isAdmin && <LeadSettingsClient initialDays={leadReopenDays} initialSilenceDays={leadSilenceDays} />}

            {/* Backfill riwayat percakapan dari ChakraHQ */}
            <ChakraSyncClient status={chakraSync} />

            {/* Prompt AI Default + Per-Number Prompt */}
            <PromptSettingsClient initialDefaults={promptDefaults} initialNumbers={numbers} />

            {/* Ganti Password */}
            <ChangePasswordClient />

          </div>
        </div>
      </main>
    </>
  );
}

function ProfileRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span style={{ fontSize: 13, color: "#64748B" }}>{label}</span>
      <span style={{ fontSize: 13, color: "#0A0A0A", fontWeight: 500, fontFamily: mono ? "JetBrains Mono, monospace" : undefined }}>
        {value}
      </span>
    </div>
  );
}
