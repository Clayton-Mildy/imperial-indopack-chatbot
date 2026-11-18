import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Several suites share app_settings rows and the uploads folder in one local DB; files run
    // one at a time so they cannot interfere (tests inside a file stay sequential as usual).
    fileParallelism: false,
    setupFiles: ['dotenv/config', './tests/setup/db-guard.ts'],
  },
})
