import { getT } from "@/lib/i18n";
import { Header } from "@/components/layout/Header";
import { getNumbers } from "@/lib/api/numbers";
import { TestPromptClient } from "./TestPromptClient";
import type { PhoneNumber } from "@/types/api";

export default async function TestPromptPage() {
  let numbers: PhoneNumber[] = [];
  try {
    numbers = await getNumbers();
  } catch (err) {
    console.warn("[test-prompt] Failed to fetch phone numbers:", err);
  }

  const t = await getT();
  return (
    <>
      <Header title={t("testPrompt.title")} />
      <TestPromptClient initialNumbers={numbers} />
    </>
  );
}
