import { auth } from "@/lib/auth";

/** The signed-in user's role, or null when there is no session. */
export async function sessionRole(): Promise<string | null> {
  const session = await auth();
  return (session?.user as { role?: string })?.role ?? null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The signed-in staff member as the API's catalog routes record them (staffId uuid, staffName 1-100
 * chars). Always read here, on the server: an actor sent by the browser is never trusted.
 */
export async function sessionStaff(): Promise<{ staffId?: string; staffName: string }> {
  const session = await auth();
  const user = session?.user as { id?: string; name?: string | null; email?: string | null } | undefined;
  const staffName = (user?.name?.trim() || user?.email?.trim() || "Staf").slice(0, 100);
  return user?.id && UUID_RE.test(user.id) ? { staffId: user.id, staffName } : { staffName };
}

/**
 * Marketing is read-only. Hiding a control is not enforcement: a "use server" action is a
 * POST endpoint any authenticated session can call directly, so every write path the leads
 * page offers checks this on the server as well as hiding its button.
 */
export async function isReadOnly(): Promise<boolean> {
  return (await sessionRole()) === "marketing";
}
