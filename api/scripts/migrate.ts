/**
 * Applies pending migrations using drizzle-orm's runtime migrator.
 *
 * Same journal (meta/_journal.json) and same bookkeeping table
 * (drizzle.__drizzle_migrations) as `drizzle-kit migrate`, so the two are
 * interchangeable. The point of this one is that drizzle-kit is a devDependency:
 * the native Windows deploy ships production deps only, and this runs on those.
 *
 * Run from the API root:  node dist-scripts/migrate.js
 */
import 'dotenv/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getDb } from '../src/db/client.js';

// Local dev keeps migrations at src/db/migrations; the deploy bundle flattens
// them to ./migrations next to dist/.
const migrationsFolder = process.env['MIGRATIONS_DIR'] ?? './migrations';

await migrate(getDb(), { migrationsFolder });
console.log(`✅ Migrations applied from ${migrationsFolder}`);
process.exit(0);
