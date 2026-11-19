import { testDbRefusal } from './test-db-refusal.js'

// Runs before every test file (after dotenv/config has loaded api/.env): refuses unless this is a
// local/test database with the capture transport. See test-db-refusal.ts for the rules.
const refusal = testDbRefusal(process.env)
if (refusal) throw new Error(refusal)
