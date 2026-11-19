import { auth } from "@/lib/auth";

/** The signed-in user's role, or null when there is no session. */
export async function sessionRole(): Promise<string | null> {
  const session = await auth();
  return (session?.user as { role?: string })?.role ?? null;
}

/**
 * Marketing is read-only. Hiding a control is not enforcement: a "use server" action is a
 * POST endpoint any authenticated session can call directly, so every write path the leads
 * page offers checks this on the server as well as hiding its button.
 */
export async function isReadOnly(): Promise<boolean> {
  return (await sessionRole()) === "marketing";
}
