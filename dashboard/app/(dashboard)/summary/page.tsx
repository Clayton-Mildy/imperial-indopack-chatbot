import { getLeadReport } from "@/lib/api/leads";
import { ApiError } from "@/lib/api/client";
import { getT } from "@/lib/i18n";
import { isReadOnly } from "@/lib/session";
import { Header } from "@/components/layout/Header";
import { SummaryClient } from "./SummaryClient";
import type { LeadReport } from "@/types/api";

export default async function SummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ startDate?: string; endDate?: string }>;
}) {
  const params = await searchParams;
  const startDate = params.startDate ?? "";
  const endDate = params.endDate ?? "";

  let report: LeadReport | null = null;
  // "invalid" = the API refused the range (400); "failed" = anything else. Neither is an error page.
  let problem: "invalid" | "failed" | null = null;
  try {
    report = await getLeadReport({
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 400) problem = "invalid";
    else {
      problem = "failed";
      console.warn("[summary] Fetch error:", err);
    }
  }

  // Marketing (read-only) never reaches a conversation, so it gets no message text either:
  // stripped here, on the server, so it never reaches their browser. The client shows "—".
  if (report && (await isReadOnly())) {
    report = { ...report, unreplied: report.unreplied.map((u) => ({ ...u, lastMessage: "" })) };
  }

  const t = await getT();
  return (
    <>
      <Header title={t("nav.summary")} />
      <SummaryClient
        report={report}
        problem={problem}
        activeStartDate={startDate}
        activeEndDate={endDate}
      />
    </>
  );
}
