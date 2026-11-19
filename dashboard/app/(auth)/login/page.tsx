import { getLang } from "@/lib/i18n";
import { LangProvider } from "@/lib/i18n/LangProvider";
import { LoginForm } from "./LoginForm";

// The login page sits outside the dashboard layout, so it gets its own provider: the language
// comes from the lang cookie (or Indonesian), the same way the dashboard layout reads it.
export default async function LoginPage() {
  const lang = await getLang();
  return (
    <LangProvider lang={lang}>
      <LoginForm />
    </LangProvider>
  );
}
