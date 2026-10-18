import { requireHousehold } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { monthRange, toMonthKey } from "@/lib/month";
import { CategoriesClient } from "./categories-client";

const MONTH_RE = /^\d{4}-\d{2}-01$/;

export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { household_id } = await requireHousehold();
  const params = await searchParams;
  const currentMonth = toMonthKey(new Date());

  const supabase = await createClient();
  const [
    { data: categories },
    { data: groups },
    { data: cards },
    { data: settings },
    { data: totals },
    { data: recurring },
  ] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name, color, kind, sort_order, archived, excluded, group_id, ideal_override, icon")
      .eq("household_id", household_id)
      .order("sort_order"),
    supabase
      .from("category_groups")
      .select("id, name, color, sort_order")
      .eq("household_id", household_id)
      .order("sort_order"),
    supabase
      .from("cards")
      .select("id, name, color, sort_order, archived")
      .eq("household_id", household_id)
      .order("sort_order"),
    supabase.from("household_settings").select("ideal_window").eq("household_id", household_id).maybeSingle(),
    supabase.from("monthly_category_totals").select("category_id, month, total").eq("household_id", household_id),
    supabase
      .from("recurring_items")
      .select("id, category_id, amount, card_id")
      .eq("household_id", household_id)
      .eq("active", true)
      .order("created_at"),
  ]);

  const recordedMonths = [...new Set((totals ?? []).map((total) => total.month))].sort();
  const latestRecorded = recordedMonths.at(-1) ?? currentMonth;
  const month = MONTH_RE.test(params.month ?? "") ? (params.month as string) : latestRecorded;
  const latestMonth = [latestRecorded, currentMonth, month].sort().at(-1) as string;
  const months = monthRange(recordedMonths[0] ?? currentMonth, latestMonth);

  const idealWindow = settings?.ideal_window ?? "trailing12";
  const expenseCategories = (categories ?? []).filter((category) => category.kind === "expense" && !category.archived);

  const idealResults = await Promise.all(
    expenseCategories.map((category) =>
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
  expenseCategories.forEach((category, index) => {
    idealByCategory[category.id] = Number(idealResults[index]?.data ?? 0);
  });

  const recurringByCategory: Record<string, { id: string; amount: number; card_id: string | null }> = {};
  for (const row of recurring ?? []) {
    if (!recurringByCategory[row.category_id]) {
      recurringByCategory[row.category_id] = { id: row.id, amount: Number(row.amount), card_id: row.card_id };
    }
  }

  return (
    <main className="min-h-screen">
      <CategoriesClient
        month={month}
        months={months}
        idealWindow={idealWindow}
        categories={(categories ?? []).map((category) => ({
          ...category,
          ideal_override: category.ideal_override == null ? null : Number(category.ideal_override),
          ideal: idealByCategory[category.id] ?? 0,
        }))}
        groups={groups ?? []}
        cards={cards ?? []}
        totals={(totals ?? []).map((total) => ({
          category_id: total.category_id,
          month: total.month,
          total: Number(total.total),
        }))}
        recurring={recurringByCategory}
      />
    </main>
  );
}
