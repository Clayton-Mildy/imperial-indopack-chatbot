import { LOCAL_DB_NAMES, databaseName } from '../../src/domain/localDatabase.js'

/**
 * Why the test suite must not run with this environment, or null when it may. The suite changes
 * live-relevant rows (switches off every product, writes fake PO links, loads and purges demo
 * products) and restores them only at the end, so it runs only against a local or test database:
 * - WHATSAPP_TRANSPORT must be `capture` (the local/test transport; production uses chakra or meta);
 * - the database must be one of this project's local databases: imperial_indopack,
 *   imperial_indopack_qa or imperial_indopack_test (an allow-list - any other app's database is refused).
 * Pure (takes the env) so it can be tested with fake values.
 */
export function testDbRefusal(env: { DATABASE_URL?: string; WHATSAPP_TRANSPORT?: string }): string | null {
  const name = databaseName(env.DATABASE_URL)
  if (!name) {
    return 'Refusing to run tests: DATABASE_URL is missing or names no database (tests run only against a local or test database)'
  }

  if (env.WHATSAPP_TRANSPORT !== 'capture') {
    return (
      'Refusing to run tests: WHATSAPP_TRANSPORT=capture is required (the local/test transport; production uses chakra or meta). ' +
      'The suite changes catalog, settings and PO-link rows - never run it on the live host or against the live database.'
    )
  }

  if (!(LOCAL_DB_NAMES as readonly string[]).includes(name)) {
    return (
      `Refusing to run tests: the database must be one of ${LOCAL_DB_NAMES.join(', ')}. ` +
      'The suite changes catalog, settings and PO-link rows - never run it against the live database or another app\'s database.'
    )
  }
  return null
}
