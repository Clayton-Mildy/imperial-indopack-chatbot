import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) {
          return null;
        }

        // Runs server-side inside the container, where the browser-facing URL may be unreachable
        // (e.g. localhost:50070 points at this container, not the API). API_INTERNAL_URL is the
        // docker-network address; the fallback keeps single-host dev setups working unchanged.
        const apiUrl =
          process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL;
        const apiKey = process.env.API_SECRET_KEY;

        if (!apiUrl || !apiKey) {
          console.error(
            "[auth] Missing API_URL or API_SECRET_KEY environment variables"
          );
          return null;
        }

        try {
          const res = await fetch(
            `${apiUrl}/api/v1/auth/verify-credentials`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                email: parsed.data.email,
                password: parsed.data.password,
              }),
            }
          );

          if (!res.ok) {
            return null;
          }

          const body = await res.json();
          const user = body.data;

          if (!user?.id || !user?.email) {
            return null;
          }

          return {
            id: user.id,
            email: user.email,
            name: user.displayName,
            role: user.role,
            language: user.language === "en" ? "en" : "id",
          };
        } catch (err) {
          console.error("[auth] verify-credentials request failed:", err);
          return null;
        }
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role;
        token.language = (user as { language?: string }).language;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        (session.user as { role?: string }).role = token.role as string;
        session.user.language = token.language === "en" ? "en" : "id";
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
