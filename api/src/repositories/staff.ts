import { eq, asc } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { getDb } from '../db/client.js';
import { staffProfiles } from '../db/schema.js';
import type { StaffProfile, StaffRole } from '../domain/types.js';

// ─── Internal mapper ────────────────────────────────────────────────────────

function mapStaff(row: typeof staffProfiles.$inferSelect): StaffProfile {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    displayName: row.name,
    role: row.role as StaffProfile['role'],
    isActive: row.isActive,
    language: row.language as StaffProfile['language'],
    createdAt: row.createdAt,
  };
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export async function listStaff(): Promise<StaffProfile[]> {
  const db = getDb();
  const rows = await db.select().from(staffProfiles).orderBy(asc(staffProfiles.createdAt));
  return rows.map(mapStaff);
}

export async function findStaffByEmail(email: string): Promise<StaffProfile | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(staffProfiles)
    .where(eq(staffProfiles.email, email))
    .limit(1);
  return row ? mapStaff(row) : null;
}

export async function findStaffById(id: string): Promise<StaffProfile | null> {
  const db = getDb();
  const [row] = await db.select().from(staffProfiles).where(eq(staffProfiles.id, id)).limit(1);
  return row ? mapStaff(row) : null;
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function createStaff(data: {
  email: string;
  password: string;
  displayName: string;
  role: StaffRole;
}): Promise<StaffProfile> {
  const db = getDb();
  const passwordHash = await bcrypt.hash(data.password, 12);
  const [row] = await db
    .insert(staffProfiles)
    .values({
      email: data.email,
      passwordHash,
      name: data.displayName,
      role: data.role,
    })
    .returning();
  if (!row) throw new Error('Failed to create staff profile');
  return mapStaff(row);
}

export async function updateStaff(
  id: string,
  data: {
    email?: string;
    displayName?: string;
    role?: StaffRole;
    isActive?: boolean;
  }
): Promise<StaffProfile | null> {
  const db = getDb();

  const patch: Partial<typeof staffProfiles.$inferInsert> = {};
  if (data.email !== undefined) patch.email = data.email;
  if (data.displayName !== undefined) patch.name = data.displayName;
  if (data.role !== undefined) patch.role = data.role;
  if (data.isActive !== undefined) patch.isActive = data.isActive;

  if (Object.keys(patch).length === 0) {
    return findStaffById(id);
  }

  const [row] = await db
    .update(staffProfiles)
    .set(patch)
    .where(eq(staffProfiles.id, id))
    .returning();
  return row ? mapStaff(row) : null;
}

export async function changeStaffPassword(id: string, newPassword: string): Promise<void> {
  const db = getDb();
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db.update(staffProfiles).set({ passwordHash }).where(eq(staffProfiles.id, id)).execute();
}

export async function deleteStaff(id: string): Promise<boolean> {
  const db = getDb();
  const result = await db
    .delete(staffProfiles)
    .where(eq(staffProfiles.id, id))
    .returning({ id: staffProfiles.id });
  return result.length > 0;
}

export async function setStaffLanguage(id: string, language: 'id' | 'en'): Promise<StaffProfile | null> {
  const db = getDb();
  const [row] = await db
    .update(staffProfiles)
    .set({ language })
    .where(eq(staffProfiles.id, id))
    .returning();
  return row ? mapStaff(row) : null;
}
