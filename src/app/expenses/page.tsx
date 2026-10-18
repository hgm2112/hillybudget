import { requireHousehold } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { monthRange, toMonthKey } from "@/lib/month";
import { ExpensesClient } from "./expenses-client";

const MONTH_RE = /^\d{4}-\d{2}-01$/;

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ month?: string; category?: string }> }) {
  const { household_id } = await requireHousehold();
  const params = await searchParams;
  const currentMonth = toMonthKey(new Date());
  const month = MONTH_RE.test(params.month ?? "") ? (params.month as string) : currentMonth;
  const focusCategory = params.category ?? null;

  const supabase = await createClient();
  const [
    { data: categories },
    { data: cards },
    { data: settings },
    { data: entries },
    { data: firstEntry },
    { data: lastEntry },
  ] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name, color, kind, ideal_override, archived")
      .eq("household_id", household_id)
      .order("sort_order"),
    supabase.from("cards").select("id, name, color, archived").eq("household_id", household_id).order("sort_order"),
    supabase.from("household_settings").select("ideal_window").eq("household_id", household_id).maybeSingle(),
    supabase
      .from("ledger_entries")
      .select("id, category_id, card_id, amount, note, recurring_item_id")
      .eq("household_id", household_id)
      .eq("month", month),
    supabase.from("ledger_entries").select("month").eq("household_id", household_id).order("month").limit(1).maybeSingle(),
    supabase
      .from("ledger_entries")
      .select("month")
      .eq("household_id", household_id)
      .order("month", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const earliestMonth = firstEntry?.month ?? currentMonth;
  const latestMonth = [lastEntry?.month, currentMonth, month]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) as string;
  const months = monthRange(earliestMonth, latestMonth);

  const idealWindow = settings?.ideal_window ?? "trailing12";
  const idealCategories = (categories ?? []).filter((category) => category.kind === "expense" && !category.archived);

  const idealResults = await Promise.all(
    idealCategories.map((category) =>
      supabase.rpc("ideal_category_amount", {
        p_household_id: household_id,
        p_category_id: category.id,
        p_current_month: month,
        p_window: idealWindow,
        p_override: category.ideal_override,
      })
    )
  );

  const idealByCategory: Record<string, number> = {};
  idealCategories.forEach((category, index) => {
    idealByCategory[category.id] = Number(idealResults[index]?.data ?? 0);
  });

  return (
    <main className="mx-auto max-w-7xl p-4 md:p-8">
      <ExpensesClient
        householdId={household_id}
        month={month}
        categories={categories ?? []}
        cards={cards ?? []}
        idealByCategory={idealByCategory}
        months={months}
        focusCategory={focusCategory}
        entries={(entries ?? []).map((entry) => ({ ...entry, amount: Number(entry.amount) }))}
      />
    </main>
  );
}
