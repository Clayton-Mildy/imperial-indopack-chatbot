import Link from "next/link";
import { auth } from "@/lib/auth";
import { Header } from "@/components/layout/Header";
import type { PhoneNumber } from "@/types/api";
import { getNumbers } from "@/lib/api/numbers";
import { getBrandPriceLists } from "@/lib/api/catalog";
import {
  getBotSettings,
  getGoLiveIssues,
  getLeadReopenMonths,
  getLeadSilenceDays,
  getPoFormsSetting,
  getPromptDefaults,
  getWhatsAppStatus,
} from "@/lib/api/settings";
import { getT } from "@/lib/i18n";
import { sessionRole } from "@/lib/session";
import { getAiDefault, getChakraSyncStatus } from "@/actions/settingsActions";
import { AiToggleClient } from "./AiToggleClient";
import { BotSettingsClient } from "./BotSettingsClient";
import { ChangePasswordClient } from "./ChangePasswordClient";
import { GoLiveBanner } from "./GoLiveBanner";
import { LanguageSelect } from "./LanguageSelect";
import { LeadSettingsClient } from "./LeadSettingsClient";
import { OrderingSettingsClient } from "./OrderingSettingsClient";
import { PromptSettingsClient } from "./PromptSettingsClient";
import { SettingsNav } from "./SettingsNav";
import { TeamSettingsClient } from "./TeamSettingsClient";
import { WhatsAppStatusClient } from "./WhatsAppStatusClient";
import { SettingsSection, labelStyle } from "./settingsUi";

/** A read that failed is null: its part of the page says so instead of showing a wrong value. */
function orNull<T>(p: Promise<T>, what: string): Promise<T | null> {
  return p.catch((err: unknown) => {
    console.warn(`[settings] Failed to load ${what}:`, err);
    return null;
  });
}

/**
 * Pengaturan (Settings.dc.html): the go-live banner, an in-page nav, and the sections Bot, Pemesanan &
 * harga, Leads, Tim & notifikasi, WhatsApp, Instruksi bot and Profil saya. Only admins change anything
 * (the proxy keeps other roles off this page; every action re-checks the role).
 */
export default async function SettingsPage() {
  const session = await auth();
  const t = await getT();
  const canEdit = (await sessionRole()) === "admin";

  const [bot, poForms, priceLists, reopenMonths, silenceDays, whatsapp, goLive, aiEnabled, chakraSync, promptSections, numbers] = await Promise.all([
    orNull(getBotSettings(), "bot settings"),
    orNull(getPoFormsSetting(), "PO forms"),
    orNull(getBrandPriceLists(), "price lists"),
    orNull(getLeadReopenMonths(), "lead reopen months"),
    orNull(getLeadSilenceDays(), "lead silence days"),
    orNull(getWhatsAppStatus(), "WhatsApp status"),
    orNull(getGoLiveIssues(), "go-live issues"),
    getAiDefault(),
    getChakraSyncStatus(),
    getPromptDefaults().catch(() => []),
    getNumbers().catch(() => [] as PhoneNumber[]),
  ]);

  const userName = session?.user?.name ?? session?.user?.email ?? "—";

  return (
    <>
      <Header title={t("settings.title")} note={t("settings.adminOnly")} />
      <GoLiveBanner issues={goLive} />
      <main style={{ flex: 1, overflowY: "auto", padding: "24px 32px 32px", display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start" }}>
        <SettingsNav />

        <div style={{ flex: "999 1 560px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <SettingsSection id="bot" title={t("settings.bot.title")}>
            <AiToggleClient initialAiEnabled={aiEnabled} canEdit={canEdit} />
            {bot ? <BotSettingsClient initial={bot} canEdit={canEdit} /> : <LoadFailed text={t("settings.err.load")} />}
          </SettingsSection>

          <SettingsSection id="pemesanan" title={t("settings.ordering.title")}>
            <OrderingSettingsClient initialForms={poForms} minPcs={bot?.fallbackMinPcs ?? null} priceLists={priceLists} canEdit={canEdit} />
          </SettingsSection>

          <SettingsSection id="leads" title={t("settings.leads.title")}>
            <LeadSettingsClient initialMonths={reopenMonths} initialSilenceDays={silenceDays} canEdit={canEdit} />
          </SettingsSection>

          <SettingsSection id="tim" title={t("settings.team.title")} gap={14}>
            <TeamSettingsClient initialMinutes={bot?.teamReminderMinutes ?? null} canEdit={canEdit} />
          </SettingsSection>

          <SettingsSection id="whatsapp" title={t("settings.wa.title")} gap={14}>
            <WhatsAppStatusClient status={whatsapp} syncMinutes={bot?.whatsappSyncMinutes ?? null} chakraSync={chakraSync} canEdit={canEdit} />
          </SettingsSection>

          <SettingsSection
            id="instruksi"
            title={t("settings.prompt.title")}
            gap={12}
            action={<Link href="/test-prompt" style={{ fontSize: 13, fontWeight: 600, color: "#445428" }}>{t("settings.prompt.tryIt")}</Link>}
          >
            <span style={{ fontSize: 12.5, color: "#3B4540" }}>{t("settings.prompt.desc")}</span>
            <PromptSettingsClient initialSections={promptSections} numbers={numbers} canEdit={canEdit} />
          </SettingsSection>

          <SettingsSection id="profil" title={t("settings.profile.title")} gap={14}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={labelStyle}>{t("settings.profile.name")}</span>
                <span style={{ fontSize: 13.5, minHeight: 38, display: "flex", alignItems: "center" }}>{userName}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label htmlFor="st-lang" style={labelStyle}>{t("settings.profile.language")}</label>
                <LanguageSelect id="st-lang" />
              </div>
            </div>
            <ChangePasswordClient />
          </SettingsSection>
        </div>
      </main>
    </>
  );
}

function LoadFailed({ text }: { text: string }) {
  return <span role="status" style={{ fontSize: 13, color: "#B91C1C" }}>{text}</span>;
}
