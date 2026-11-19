/**
 * Why the test suite must not run with this environment, or null when it may. The suite changes
 * live-relevant rows (switches off every product, writes fake PO links, loads and purges demo
 * products) and restores them only at the end, so it runs only against a local or test database:
 * - WHATSAPP_TRANSPORT must be `capture` (the local/test transport; production uses chakra or meta);
 * - the database must be `imperial_indopack` (the local dev DB) or a name ending in `_qa` / `_test`;
 * - nothing Legacy, ever.
 * Pure (takes the env) so it can be tested with fake values.
 */
export function testDbRefusal(env: { DATABASE_URL?: string; WHATSAPP_TRANSPORT?: string }): string | null {
  const dbUrl = env.DATABASE_URL ?? ''
  if (/legacy/i.test(dbUrl)) return 'Refusing to run tests against a Legacy database'

  let dbName = ''
  try {
    dbName = decodeURIComponent(new URL(dbUrl).pathname.replace(/^\/+/, ''))
  } catch {
    // unreadable: refused below
  }
  if (!dbName) {
    return 'Refusing to run tests: DATABASE_URL is missing or names no database (tests run only against a local or test database)'
  }

  if (env.WHATSAPP_TRANSPORT !== 'capture') {
    return (
      'Refusing to run tests: WHATSAPP_TRANSPORT=capture is required (the local/test transport; production uses chakra or meta). ' +
      'The suite changes catalog, settings and PO-link rows - never run it on the live host or against the live database.'
    )
  }

  const name = dbName.toLowerCase()
  if (name !== 'imperial_indopack' && !name.endsWith('_qa') && !name.endsWith('_test')) {
    return (
      'Refusing to run tests: the database must be the local dev DB imperial_indopack or a name ending in _qa or _test. ' +
      'The suite changes catalog, settings and PO-link rows - never run it against the live database.'
    )
  }
  return null
}
