/**
 * Local seed: admin, a dashboard API key and a capture phone number, for local testing only.
 * Run: npx tsx scripts/seed-local.ts
 *
 * Env: DATABASE_URL, SEED_API_KEY (>= 32 chars), SEED_ADMIN_EMAIL / _PASSWORD / _NAME (optional).
 * Prints counts only, never a secret.
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { createHash } from 'crypto';
import bcrypt from 'bcryptjs';
import * as schema from '../src/db/schema.js';

async function seedLocal() {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('DATABASE_URL is required');
  if (/legacy/i.test(connectionString)) throw new Error('Refusing to seed a database whose URL matches /legacy/i');
  const apiKey = process.env['SEED_API_KEY'] ?? '';
  if (apiKey.length < 32) throw new Error('SEED_API_KEY is required (at least 32 characters)');

  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  try {
    const email = process.env['SEED_ADMIN_EMAIL'] ?? 'admin@imperial-indopack.example.com';
    const password = process.env['SEED_ADMIN_PASSWORD'] ?? 'changeme123';
    const name = process.env['SEED_ADMIN_NAME'] ?? 'Admin';

    const admin = await db
      .insert(schema.staffProfiles)
      .values({ email, passwordHash: await bcrypt.hash(password, 12), name, role: 'admin' })
      .onConflictDoNothing()
      .returning({ id: schema.staffProfiles.id });

    const key = await db
      .insert(schema.apiKeys)
      .values({ keyHash: createHash('sha256').update(apiKey).digest('hex'), label: 'local dashboard' })
      .onConflictDoNothing()
      .returning({ id: schema.apiKeys.id });

    const phone = await db
      .insert(schema.phoneNumbers)
      .values({ number: '+620000000070', label: 'Nomor lokal (capture)', wabaId: 'local-waba', phoneNumberId: 'local-phone-70' })
      .onConflictDoNothing()
      .returning({ id: schema.phoneNumbers.id });

    console.log(`admin: ${admin.length}, api key: ${key.length}, phone number: ${phone.length}`);
  } finally {
    await pool.end();
  }
}

seedLocal().catch((err) => {
  console.error('Seed failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
