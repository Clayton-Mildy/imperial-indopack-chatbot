import { getNumbers } from "@/lib/api/numbers";
import { getT } from "@/lib/i18n";
import { Header } from "@/components/layout/Header";
import { NumbersClient } from "./NumbersClient";

export default async function NumbersPage() {
  let numbers: import("@/types/api").PhoneNumber[] = [];
  try {
    numbers = await getNumbers();
  } catch (err) {
    console.warn("[numbers] Failed to fetch phone numbers:", err);
  }

  const t = await getT();
  return (
    <>
      <Header title={t("numbers.title")} />
      <NumbersClient initialNumbers={numbers} />
    </>
  );
}
