import { requireHousehold } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { DashboardClient } from "./dashboard-client";

export default async function DashboardPage() {
  const { household_id } = await requireHousehold();
  const supabase = await createClient();

  const [{ data: categories }, { data: totals }, { data: accounts }, { data: balances }, { data: paused }] =
    await Promise.all([
      supabase.from("categories").select("id, name, color, kind").eq("household_id", household_id),
      supabase.from("monthly_category_totals").select("category_id, month, total").eq("household_id", household_id),
      supabase.from("accounts").select("id, name, kind").eq("household_id", household_id),
      supabase.from("account_balances").select("account_id, month, balance").eq("household_id", household_id),
      supabase.from("paused_months").select("month").eq("household_id", household_id),
    ]);

  return (
    <main className="min-h-screen">
      <DashboardClient
        categories={(categories ?? []).map((category) => ({
          id: category.id,
          name: category.name,
          color: category.color,
          kind: category.kind as "expense" | "income",
        }))}
        totals={(totals ?? []).map((row) => ({
          category_id: row.category_id,
          month: row.month,
          total: Number(row.total),
        }))}
        accounts={(accounts ?? []).map((account) => ({
          id: account.id,
          name: account.name,
          kind: account.kind as "liquid" | "retirement" | "loan",
        }))}
        balances={(balances ?? []).map((balance) => ({
          account_id: balance.account_id,
          month: balance.month,
          balance: Number(balance.balance),
        }))}
        pausedMonths={(paused ?? []).map((row) => row.month)}
      />
    </main>
  );
}
