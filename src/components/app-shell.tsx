import { getHousehold } from "@/lib/session";
import { AppSidebar } from "@/components/app-sidebar";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const household = await getHousehold();
  if (!household) return <>{children}</>;

  return (
    <div className="flex min-h-screen w-full flex-col md:flex-row">
      <AppSidebar membership={household} />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
