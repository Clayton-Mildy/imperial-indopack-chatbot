import { getT } from "@/lib/i18n";
import { Header } from "@/components/layout/Header";
import { listStaff } from "@/lib/api/staff";
import { AdminClient } from "./AdminClient";

export default async function AdminPage() {
  const staff = await listStaff();
  const t = await getT();

  return (
    <>
      <Header title={t("admin.title")} />
      <AdminClient initialStaff={staff} />
    </>
  );
}
