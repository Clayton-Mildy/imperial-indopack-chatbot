import { describe, expect, it } from 'vitest'
import { testDbRefusal } from './setup/test-db-refusal.js'

// The suite switches off every product, writes fake PO links and loads/purges demo products; it
// restores only at the end. It may run only against a local/test database with the capture
// transport. Fake env values only - never the real .env.
const url = (db: string) => `postgresql://contoh:contoh@localhost:5432/${db}`

describe('testDbRefusal', () => {
  it.each(['imperial_indopack', 'imperial_indopack_qa', 'contoh_test', 'IMPERIAL_INDOPACK_QA'])(
    'allows %s with the capture transport',
    (db) => {
      expect(testDbRefusal({ DATABASE_URL: url(db), WHATSAPP_TRANSPORT: 'capture' })).toBeNull()
    },
  )

  it('allows a query string after the database name', () => {
    expect(testDbRefusal({ DATABASE_URL: `${url('imperial_indopack')}?sslmode=disable`, WHATSAPP_TRANSPORT: 'capture' })).toBeNull()
  })

  it.each([undefined, 'chakra', 'meta', '', 'CAPTURE'])('refuses transport %j and says why', (transport) => {
    const refusal = testDbRefusal({ DATABASE_URL: url('imperial_indopack'), WHATSAPP_TRANSPORT: transport })
    expect(refusal).toMatch(/WHATSAPP_TRANSPORT=capture/)
  })

  it.each(['imperial_indopack_prod', 'postgres', 'imperial', 'imperial_indopack_live', 'qa', 'test', 'contoh_testing'])(
    'refuses database %s and says why',
    (db) => {
      const refusal = testDbRefusal({ DATABASE_URL: url(db), WHATSAPP_TRANSPORT: 'capture' })
      expect(refusal).toMatch(/imperial_indopack/)
      expect(refusal).toMatch(/_qa/)
      expect(refusal).toMatch(/_test/)
    },
  )

  it.each(['legacy_test', 'imperial_indopack_qa?application_name=legacy', 'LEGACY_qa'])('still refuses anything Legacy: %s', (db) => {
    expect(testDbRefusal({ DATABASE_URL: url(db), WHATSAPP_TRANSPORT: 'capture' })).toMatch(/Legacy/)
  })

  it.each([undefined, '', 'not a url', 'postgresql://localhost:5432/'])('refuses a missing or unreadable DATABASE_URL %j', (dbUrl) => {
    expect(testDbRefusal({ DATABASE_URL: dbUrl, WHATSAPP_TRANSPORT: 'capture' })).toMatch(/DATABASE_URL/)
  })
})
