"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { apiFetch } from "@/lib/api/client";
import { LANG_COOKIE, isLang, type Lang } from "./core";

/**
 * Saves the signed-in user's own language. Open to every role (marketing included): it changes
 * only their preference. The cookie is what makes the switch instant and survives the JWT, which
 * only learns the saved language at the next sign-in.
 */
export async function setLanguage(lang: Lang): Promise<{ ok: boolean }> {
  if (!isLang(lang)) return { ok: false };
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false };

  let saved = true;
  try {
    await apiFetch(`/staff/${encodeURIComponent(userId)}/language`, {
      method: "PATCH",
      body: JSON.stringify({ language: lang }),
    });
  } catch (err) {
    saved = false;
    console.error("[i18n] saving language failed:", err);
  }

  // Path "/" so the cookie is sent under the /app basePath as well.
  (await cookies()).set(LANG_COOKIE, lang, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  revalidatePath("/", "layout");
  return { ok: saved };
}
