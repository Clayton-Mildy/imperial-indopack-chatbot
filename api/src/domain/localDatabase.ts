/**
 * Guards for the scripts and tests that write throwaway data (seed-local, the demo catalog, the
 * test suite, the QA harness). They may only touch this project's own local databases, named
 * `imperial_indopack`, `imperial_indopack_qa` or `imperial_indopack_test` - an allow-list, so a
 * database of any other app on the same machine is refused without having to name it.
 */
export const LOCAL_DB_NAMES = ['imperial_indopack', 'imperial_indopack_qa', 'imperial_indopack_test'] as const;

/** The database name in a Postgres URL (decoded, lower-cased), or null when there is none. */
export function databaseName(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const name = decodeURIComponent(new URL(url).pathname.replace(/^\/+/, '')).toLowerCase();
    return name || null;
  } catch {
    return null;
  }
}

/** True only for one of this project's own local databases. */
export function isLocalProjectDb(url: string | undefined): boolean {
  const name = databaseName(url);
  return name !== null && (LOCAL_DB_NAMES as readonly string[]).includes(name);
}
