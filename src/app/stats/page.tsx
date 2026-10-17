import { requireHousehold } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { toMonthKey } from "@/lib/month";
import { StatsClient } from "./stats-client";

export default async function StatsPage() {
  const { household_id } = await requireHousehold();
  const supabase = await createClient();

  const [{ data: categories }, { data: entries }] = await Promise.all([
    supabase.from("categories").select("id, name, color, kind").eq("household_id", household_id).order("sort_order"),
    supabase.from("ledger_entries").select("month, category_id, amount").eq("household_id", household_id),
  ]);

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <StatsClient
        defaultMonth={toMonthKey(new Date())}
        categories={(categories ?? []).map((category) => ({
          id: category.id,
          name: category.name,
          color: category.color,
          kind: category.kind as "expense" | "income",
        }))}
        entries={(entries ?? []).map((entry) => ({
          month: entry.month,
          category_id: entry.category_id,
          amount: Number(entry.amount),
        }))}
      />
    </main>
  );
}
