if (/legacy/i.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests against a Legacy database')
}
