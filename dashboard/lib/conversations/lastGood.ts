import { useEffect, useState } from "react";

// The Percakapan pages poll by re-running the server page. A poll whose fetch failed hands the client
// null for that piece; the screen keeps the last good value instead of blanking (or unmounting the
// reply draft and unsaved notes with it). Keyed, so one conversation never shows another's data.

export interface Kept<T> {
  key: string;
  value: T | null;
}

/** The value to keep after a poll: a fresh value replaces it; a failure keeps it, unless the key moved on. */
export function nextKept<T>(kept: Kept<T>, key: string, value: T | null): Kept<T> {
  return value !== null || kept.key !== key ? { key, value } : kept;
}

/** What to show: the fresh value, else the kept one of the same key. */
export function shownValue<T>(kept: Kept<T>, key: string, value: T | null): T | null {
  return value ?? (kept.key === key ? kept.value : null);
}

/** Client components only: `value` from this poll (null = its fetch failed), shown or kept per `key`. */
export function useLastGood<T>(value: T | null, key: string): T | null {
  const [kept, setKept] = useState<Kept<T>>({ key, value });
  useEffect(() => {
    setKept((k) => nextKept(k, key, value));
  }, [key, value]);
  return shownValue(kept, key, value);
}
