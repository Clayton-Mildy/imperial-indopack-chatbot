// Server entry point. Client components import from "./core" / "./LangProvider" instead.
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { LANG_COOKIE, isLang, makeT, type Lang, type TFn } from "./core";

export * from "./core";

/** Order: valid `lang` cookie, then the account's saved language (session), then Indonesian. */
export async function getLang(): Promise<Lang> {
  const fromCookie = (await cookies()).get(LANG_COOKIE)?.value;
  if (isLang(fromCookie)) return fromCookie;
  const session = await auth();
  const fromSession = (session?.user as { language?: unknown } | undefined)?.language;
  return isLang(fromSession) ? fromSession : "id";
}

/** Translator for server components. */
export async function getT(): Promise<TFn> {
  return makeT(await getLang());
}
