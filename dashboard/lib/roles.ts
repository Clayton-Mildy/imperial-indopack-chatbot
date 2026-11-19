import type { TFn, TKey } from "@/lib/i18n/core";

// Client-safe: only a type import (erased), so a Client Component can use it without pulling in the auth
// config. The role strings themselves are validated server-side (api/src/domain/schemas.ts).

/** Sidebar / settings badge. Without this marketing would render as "Agen". */
const ROLE_KEY: Record<string, TKey> = {
  admin: "common.role.admin",
  agent: "common.role.agent",
  marketing: "common.role.marketing",
};

export function roleLabel(role: string, t: TFn): string {
  return t(ROLE_KEY[role] ?? "common.role.agent");
}
