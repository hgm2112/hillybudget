import { requireHousehold } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { toMonthKey, monthRange } from "@/lib/month";
import { AccountsClient } from "./accounts-client";

const MONTH_RE = /^\d{4}-\d{2}-01$/;

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { household_id } = await requireHousehold();
  const params = await searchParams;
  const currentMonth = toMonthKey(new Date());
  const month = MONTH_RE.test(params.month ?? "") ? (params.month as string) : currentMonth;

  const supabase = await createClient();
  const [{ data: accounts }, { data: balances }, { data: skipped }, { data: archives }, { data: firstArchive }] =
    await Promise.all([
    supabase
      .from("accounts")
      .select("id, name, kind, color, sort_order, original_amount, interest_rate, monthly_payment, start_date")
      .eq("household_id", household_id)
      .order("sort_order"),
    supabase.from("account_balances").select("id, account_id, month, balance").eq("household_id", household_id),
    supabase.from("skipped_months").select("month").eq("household_id", household_id),
    supabase
      .from("account_archive_periods")
      .select("account_id")
      .eq("household_id", household_id)
      .lte("start_month", month)
      .or(`end_month.is.null,end_month.gt.${month}`),
    supabase
      .from("account_archive_periods")
      .select("start_month")
      .eq("household_id", household_id)
      .order("start_month")
      .limit(1)
      .maybeSingle(),
  ]);

  const monthSet = new Set<string>([currentMonth, month]);
  (balances ?? []).forEach((balance) => monthSet.add(balance.month));
  (skipped ?? []).forEach((row) => monthSet.add(row.month));
  if (firstArchive?.start_month) monthSet.add(firstArchive.start_month);
  const sortedMonths = [...monthSet].sort();
  const months = monthRange(sortedMonths[0], sortedMonths[sortedMonths.length - 1]);

  const numeric = (value: unknown) => (value === null || value === undefined ? null : Number(value));

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <AccountsClient
        month={month}
        accounts={(accounts ?? []).map((account) => ({
          ...account,
          original_amount: numeric(account.original_amount),
          interest_rate: numeric(account.interest_rate),
          monthly_payment: numeric(account.monthly_payment),
        }))}
        balances={(balances ?? []).map((balance) => ({ ...balance, balance: Number(balance.balance) }))}
        skipped={(skipped ?? []).map((row) => row.month)}
        archivedIds={(archives ?? []).map((row) => row.account_id)}
        months={months}
      />
    </main>
  );
}
