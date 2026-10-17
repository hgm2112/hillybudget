import { requireHousehold } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { RecurringClient } from "./recurring-client";

export default async function RecurringPage() {
  const { household_id } = await requireHousehold();
  const supabase = await createClient();

  const [{ data: categories }, { data: cards }, { data: templates }] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name, color, archived")
      .eq("household_id", household_id)
      .order("sort_order"),
    supabase
      .from("cards")
      .select("id, name, color, archived")
      .eq("household_id", household_id)
      .order("sort_order"),
    supabase
      .from("recurring_items")
      .select("id, category_id, card_id, amount, note, start_month, end_month, active")
      .eq("household_id", household_id)
      .order("start_month"),
  ]);

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <RecurringClient
        categories={categories ?? []}
        cards={cards ?? []}
        templates={(templates ?? []).map((template) => ({ ...template, amount: Number(template.amount) }))}
        defaultStartMonth={`${new Date().toISOString().slice(0, 7)}-01`}
      />
    </main>
  );
}
