"use server";

import { getTeamQueue } from "@/lib/api/teamQueue";

/** The sidebar badge: how many chats wait on the team. 0 when the API is unreachable. */
export async function getTeamQueueCount(): Promise<number> {
  try {
    return (await getTeamQueue()).waitingCount;
  } catch {
    return 0;
  }
}
