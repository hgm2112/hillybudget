import { createClient } from "@/lib/supabase/server";
import { toMonthKey } from "@/lib/month";
import type { HouseholdMembership } from "@/lib/household";
import { Sidebar, type SidebarSection } from "@/components/sidebar";

const SECTION_LABELS: Record<string, string> = {
  loan: "Loan",
  retirement: "Investments",
  liquid: "Cash",
};

const SECTION_ORDER = ["liquid", "retirement", "loan"];

export async function AppSidebar({ membership }: { membership: HouseholdMembership }) {
  const supabase = await createClient();
  const currentMonth = toMonthKey(new Date());
  const [{ data: householdRow }, { data: accounts }, { data: balances }, { data: archives }] = await Promise.all([
    supabase.from("households").select("name").eq("id", membership.household_id).maybeSingle(),
    supabase
      .from("accounts")
      .select("id, name, kind, sort_order")
      .eq("household_id", membership.household_id)
      .order("sort_order"),
    supabase
      .from("account_balances")
      .select("account_id, month, balance")
      .eq("household_id", membership.household_id)
      .lte("month", currentMonth)
      .order("month", { ascending: false }),
    supabase
      .from("account_archive_periods")
      .select("account_id")
      .eq("household_id", membership.household_id)
      .lte("start_month", currentMonth)
      .or(`end_month.is.null,end_month.gt.${currentMonth}`),
  ]);

  const archivedIds = new Set((archives ?? []).map((row) => row.account_id));

  const latest = new Map<string, number>();
  for (const row of balances ?? []) {
    if (!latest.has(row.account_id)) latest.set(row.account_id, Number(row.balance));
  }

  const byKind = new Map<string, SidebarSection["items"]>();
  for (const account of accounts ?? []) {
    if (archivedIds.has(account.id)) continue;
    const items = byKind.get(account.kind) ?? [];
    items.push({ id: account.id, name: account.name, balance: latest.get(account.id) ?? null });
    byKind.set(account.kind, items);
  }

  const sections: SidebarSection[] = SECTION_ORDER.filter((kind) => byKind.has(kind)).map((kind) => ({
    label: SECTION_LABELS[kind] ?? kind,
    items: byKind.get(kind) ?? [],
  }));

  return <Sidebar householdName={householdRow?.name ?? "Household"} role={membership.role} sections={sections} />;
}
