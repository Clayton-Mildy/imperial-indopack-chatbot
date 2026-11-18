/**
 * Seed script — inserts initial admin account and generates first API key.
 * Run: npm run db:seed
 *
 * Required env vars:
 *   DATABASE_URL
 *   SEED_ADMIN_EMAIL
 *   SEED_ADMIN_PASSWORD
 *   SEED_ADMIN_NAME
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { createHash, randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import * as schema from '../src/db/schema.js';

async function seed() {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('DATABASE_URL is required');

  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  const email = process.env['SEED_ADMIN_EMAIL'] ?? 'admin@imperial-indopack.example.com';
  const password = process.env['SEED_ADMIN_PASSWORD'] ?? 'changeme123';
  const name = process.env['SEED_ADMIN_NAME'] ?? 'Admin';

  console.log(`Seeding admin: ${email}`);
  const passwordHash = await bcrypt.hash(password, 12);

  const [staff] = await db
    .insert(schema.staffProfiles)
    .values({ email, passwordHash, name, role: 'admin' })
    .onConflictDoNothing()
    .returning();

  if (!staff) {
    console.log('Admin already exists — skipping');
  } else {
    console.log(`Admin created: ${staff.id}`);
  }

  // Generate API key
  const rawKey = randomBytes(32).toString('hex');
  const keyHash = createHash('sha256').update(rawKey).digest('hex');

  const staffId = staff?.id ?? (await db.query.staffProfiles.findFirst({
    where: (t, { eq }) => eq(t.email, email),
  }))?.id;

  await db.insert(schema.apiKeys).values({
    keyHash,
    label: 'imperial-indopack-dashboard production',
    createdBy: staffId ?? undefined,
  }).onConflictDoNothing();

  console.log('\n=== API KEY (copy this — shown only once) ===');
  console.log(`Raw key: ${rawKey}`);
  console.log('Set this as API_SECRET_KEY in the dashboard .env');
  console.log('==============================================\n');

  await pool.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
