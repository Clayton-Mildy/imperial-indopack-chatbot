/**
 * latency-cleanups.test.ts
 * Regression checks for the response-time cleanups: the single-round-trip
 * contact-profile upsert, and listProducts' COUNT skip at limit 0. Real DB
 * (legacy_regression), following catalog-v2.test.ts's prefix-and-cleanup pattern.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import 'dotenv/config';
import { like } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { contacts } from '../src/db/schema.js';
import { upsertContactProfile, getContactProfile } from '../src/repositories/contactProfiles.js';
import { listProducts } from '../src/repositories/products.js';

const TEST_PREFIX = '__latency_cleanups_test__';

describe('upsertContactProfile — single-statement upsert', () => {
  let contactId: string;

  beforeAll(async () => {
    const db = getDb();
    const [row] = await db
      .insert(contacts)
      .values({ waId: `${TEST_PREFIX}wa`, displayName: `${TEST_PREFIX}name` })
      .returning({ id: contacts.id });
    contactId = row!.id;
  });

  afterAll(async () => {
    const db = getDb();
    // contact_profiles has ON DELETE CASCADE on contact_id
    await db.delete(contacts).where(like(contacts.waId, `${TEST_PREFIX}%`));
  });

  it('creates on first call, merges the jsonb patch and preserves fields on the second', async () => {
    const created = await upsertContactProfile(contactId, {
      customerType: 'end_user',
      profilePatch: { name: 'Budi', quantity: 12 },
    });
    expect(created.customerType).toBe('end_user');
    expect(created.profile).toMatchObject({ name: 'Budi', quantity: 12 });

    // Second turn: patch one key, add another, say nothing about customerType.
    const updated = await upsertContactProfile(contactId, {
      profilePatch: { quantity: 24, budget: '100rb' },
      followUpNotes: 'tunggu foto',
    });
    expect(updated.customerType).toBe('end_user'); // preserved, not nulled
    expect(updated.profile).toMatchObject({ name: 'Budi', quantity: 24, budget: '100rb' }); // merged
    expect(updated.followUpNotes).toBe('tunggu foto');

    const read = await getContactProfile(contactId);
    expect(read?.profile).toMatchObject({ name: 'Budi', quantity: 24, budget: '100rb' });
  });
});

describe('listProducts limit 0 (full-catalog path)', () => {
  it('still reports the correct total without the COUNT query', async () => {
    const { products: all, total } = await listProducts({ limit: 0 });
    expect(total).toBe(all.length); // total now derives from the fetched rows
  });
});
