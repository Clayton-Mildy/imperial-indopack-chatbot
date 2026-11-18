/**
 * Seed the default prompt sections into app_settings.
 * Run: npx tsx scripts/seed-default-prompt.ts
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import * as schema from '../src/db/schema.js';
import type { PromptSections } from '../src/domain/types.js';
import { SYSTEM_PROMPT_SECTIONS } from '../src/domain/constants.js';

const DEFAULT_PROMPT_SECTIONS_KEY = 'default_prompt_sections';

const defaultSections: PromptSections = SYSTEM_PROMPT_SECTIONS;

async function run() {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('DATABASE_URL is required');

  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  await db
    .insert(schema.appSettings)
    .values({ key: DEFAULT_PROMPT_SECTIONS_KEY, value: defaultSections })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value: defaultSections, updatedAt: new Date() },
    });

  const [row] = await db
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, DEFAULT_PROMPT_SECTIONS_KEY))
    .limit(1);

  const sections = row?.value as PromptSections;
  console.log(`Seeded ${sections.length} default prompt sections:`);
  sections.forEach((s) => console.log(`  - ${s.name} (${s.content.length} chars)`));

  await pool.end();
}

run().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
