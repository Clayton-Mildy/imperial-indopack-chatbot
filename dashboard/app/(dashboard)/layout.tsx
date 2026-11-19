import { Sidebar } from "@/components/layout/Sidebar";
import { auth } from "@/lib/auth";
import { LangProvider } from "@/lib/i18n/LangProvider";
import { getLang } from "@/lib/i18n";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const role = (session?.user as { role?: string })?.role ?? "agent";
  const lang = await getLang();
  const userName = session?.user?.name ?? session?.user?.email ?? "Pengguna";

  return (
    <LangProvider lang={lang}>
    <div className="flex h-screen overflow-hidden" style={{ background: "#F2F5EF" }}>
      {/* Sidebar — fixed left column */}
      <aside
        className="flex-shrink-0 flex flex-col"
        style={{
          width: 240,
          background: "#F8FAF6",
          borderRight: "1px solid #E1E7DC",
        }}
      >
        <Sidebar role={role} userName={userName} />
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {children}
      </div>
    </div>
    </LangProvider>
  );
}
