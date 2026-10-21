import { requireHousehold } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { toMonthKey } from "@/lib/month";
import { StatsClient } from "./stats-client";

export default async function StatsPage() {
  const { household_id } = await requireHousehold();
  const supabase = await createClient();

  const [{ data: categories }, { data: entries }, { data: paused }] = await Promise.all([
    supabase.from("categories").select("id, name, color, kind").eq("household_id", household_id).order("sort_order"),
    supabase.from("ledger_entries").select("month, category_id, amount").eq("household_id", household_id),
    supabase.from("paused_months").select("month").eq("household_id", household_id),
  ]);

  const pausedMonths = new Set((paused ?? []).map((row) => row.month));
  const activeEntries = (entries ?? []).filter((entry) => !pausedMonths.has(entry.month));

  const latestRecorded =
    activeEntries.reduce((latest, entry) => (entry.month > latest ? entry.month : latest), "") ||
    toMonthKey(new Date());

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <StatsClient
        defaultMonth={latestRecorded}
        categories={(categories ?? []).map((category) => ({
          id: category.id,
          name: category.name,
          color: category.color,
          kind: category.kind as "expense" | "income",
        }))}
        entries={activeEntries.map((entry) => ({
          month: entry.month,
          category_id: entry.category_id,
          amount: Number(entry.amount),
        }))}
      />
    </main>
  );
}
