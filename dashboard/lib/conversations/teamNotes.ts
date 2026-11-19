import type { TeamNotes } from "@/types/api";

const time = (iso: string | null): number => (iso ? new Date(iso).getTime() || 0 : 0);

/**
 * Catatan tim as the 3 s poll brings it back: the notes to show instead of what the box holds, or
 * null to leave the box alone. Taken only when nothing local is unsaved (no edit, no save out) and
 * the server's notes are newer than the last save this box knows, so a poll that left before our
 * own save cannot put the old text back.
 */
export function adoptIncomingNotes(text: string, saved: TeamNotes, incoming: TeamNotes, saving: boolean): TeamNotes | null {
  if (saving || text !== saved.text) return null;
  if (time(incoming.updatedAt) <= time(saved.updatedAt)) return null;
  return incoming;
}
