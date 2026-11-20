import { Header } from "@/components/layout/Header";
import { getTeamQueue } from "@/lib/api/teamQueue";
import { getT } from "@/lib/i18n";
import { sessionStaff } from "@/lib/session";
import type { TeamQueue } from "@/types/api";
import { TeamQueueClient } from "./TeamQueueClient";

/** Perlu Tim: chats waiting on the team, by hand-off reason. `?mine=1` = "Ditangani saya" (the session's staff name); `?tab=` = the selected category tab. */
export default async function TeamQueuePage({ searchParams }: { searchParams: Promise<{ mine?: string; tab?: string }> }) {
  const t = await getT();
  const sp = await searchParams;
  const mine = sp.mine === "1";
  const { staffName } = await sessionStaff();

  // null = the fetch failed; the client keeps the queue it already shows.
  let queue: TeamQueue | null = null;
  try {
    queue = await getTeamQueue(mine ? staffName : undefined);
  } catch (err) {
    console.warn("[team-queue] Fetch failed:", err);
  }

  return (
    <>
      <Header title={t("nav.teamQueue")} />
      <TeamQueueClient queue={queue} mine={mine} initialTab={sp.tab ?? null} />
    </>
  );
}
