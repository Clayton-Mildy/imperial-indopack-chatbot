import { Header } from "@/components/layout/Header";
import { listActivityLogs } from "@/lib/api/activityLogs";
import { getT } from "@/lib/i18n";
import { ActivityClient } from "./ActivityClient";

export default async function ActivityPage() {
  const t = await getT();
  let initialData: Awaited<ReturnType<typeof listActivityLogs>> = {
    data: [],
    meta: { page: 1, total: 0, limit: 20 },
  };

  try {
    initialData = await listActivityLogs({ page: 1, limit: 20 });
  } catch {
    // ActivityClient will display empty state
  }

  return (
    <>
      <Header title={t("activity.title")} />
      <ActivityClient initialData={initialData} />
    </>
  );
}
