"use server";

import { getEscalations } from "@/lib/api/escalations";

export async function getEscalationCount(): Promise<number> {
  try {
    const escalations = await getEscalations();
    return escalations.length;
  } catch {
    return 0;
  }
}
