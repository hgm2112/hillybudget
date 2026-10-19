"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowLeftRight,
  BarChart3,
  ChartLine,
  ChartPie,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "cn";
import { money } from "@/lib/money";
import { monthLabel, shiftMonth, toMonthKey } from "@/lib/month";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";

type CategoryKind = "expense" | "income";
type Category = { id: string; name: string; color: string; kind: CategoryKind };
type Total = { category_id: string; month: string; total: number };
type Account = { id: string; name: string; kind: "liquid" | "retirement" | "loan" };
type Balance = { account_id: string; month: string; balance: number };

const PERIODS = [
  { key: "3M", months: 3 },
  { key: "6M", months: 6 },
  { key: "12M", months: 12 },
  { key: "YTD", months: 0 },
] as const;
type Period = (typeof PERIODS)[number]["key"];

const INCOME = "#10b981";
const EXPENSE = "#ef4444";
const ACCENT = "#d85700";

function shortLabel(key: string) {
  return new Date(key + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
}

function rangeLabel(months: string[]) {
  if (months.length === 0) return "";
  const first = new Date(months[0] + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const last = new Date(months[months.length - 1] + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${first} – ${last}`;
}

function windowMonths(period: Period, anchor: string) {
  if (period === "YTD") {
    const months: string[] = [];
    let cursor = `${anchor.slice(0, 4)}-01-01`;
    while (cursor <= anchor) {
      months.push(cursor);
      cursor = shiftMonth(cursor, 1);
    }
    return months;
  }
  const count = PERIODS.find((entry) => entry.key === period)?.months ?? 12;
  return Array.from({ length: count }, (_, index) => shiftMonth(anchor, index - (count - 1)));
}

export function DashboardClient({
  categories,
  totals,
  accounts,
  balances,
}: {
  categories: Category[];
  totals: Total[];
  accounts: Account[];
  balances: Balance[];
}) {
  const [period, setPeriod] = useState<Period>("12M");

  const flowAnchor = useMemo(() => {
    let latest = "";
    for (const row of totals) if (row.month > latest) latest = row.month;
    return latest || toMonthKey(new Date());
  }, [totals]);

  const netAnchor = useMemo(() => {
    let latest = "";
    for (const balance of balances) if (balance.month > latest) latest = balance.month;
    return latest || toMonthKey(new Date());
  }, [balances]);

  const flowMonths = useMemo(() => windowMonths(period, flowAnchor), [period, flowAnchor]);
  const netMonths = useMemo(() => windowMonths(period, netAnchor), [period, netAnchor]);

  const kindById = useMemo(() => new Map(categories.map((category) => [category.id, category.kind])), [categories]);
  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const accountKind = useMemo(() => new Map(accounts.map((account) => [account.id, account.kind])), [accounts]);

  const monthly = useMemo(() => {
    const map = new Map<string, { income: number; expense: number }>();
    for (const row of totals) {
      const kind = kindById.get(row.category_id);
      if (!kind) continue;
      const entry = map.get(row.month) ?? { income: 0, expense: 0 };
      entry[kind] += row.total;
      map.set(row.month, entry);
    }
    return map;
  }, [totals, kindById]);

  const rangeIncome = flowMonths.reduce((sum, month) => sum + (monthly.get(month)?.income ?? 0), 0);
  const rangeExpense = flowMonths.reduce((sum, month) => sum + (monthly.get(month)?.expense ?? 0), 0);
  const netCashFlow = rangeIncome - rangeExpense;

  const trendData = useMemo(
    () => flowMonths.map((month) => ({ key: month, label: shortLabel(month), expense: monthly.get(month)?.expense ?? 0 })),
    [flowMonths, monthly]
  );
  const compareData = useMemo(
    () =>
      flowMonths.map((month) => ({
        key: month,
        label: shortLabel(month),
        income: monthly.get(month)?.income ?? 0,
        expense: monthly.get(month)?.expense ?? 0,
      })),
    [flowMonths, monthly]
  );

  const categoryData = useMemo(() => {
    const inRange = new Set(flowMonths);
    const map = new Map<string, number>();
    for (const row of totals) {
      if (!inRange.has(row.month) || kindById.get(row.category_id) !== "expense") continue;
      map.set(row.category_id, (map.get(row.category_id) ?? 0) + row.total);
    }
    return [...map.entries()]
      .map(([id, value]) => ({ name: categoryById.get(id)?.name ?? "Unknown", value, color: categoryById.get(id)?.color ?? "#6b7280" }))
      .filter((row) => row.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [totals, flowMonths, kindById, categoryById]);

  const latestByAccount = useMemo(() => {
    const map = new Map<string, { month: string; balance: number }>();
    for (const balance of balances) {
      const current = map.get(balance.account_id);
      if (!current || balance.month > current.month) {
        map.set(balance.account_id, { month: balance.month, balance: balance.balance });
      }
    }
    return map;
  }, [balances]);

  const netWorth = useMemo(() => {
    let assets = 0;
    let liabilities = 0;
    let latest = "";
    for (const [accountId, snapshot] of latestByAccount) {
      const kind = accountKind.get(accountId);
      if (!kind) continue;
      if (kind === "loan") liabilities += snapshot.balance;
      else assets += snapshot.balance;
      if (snapshot.month > latest) latest = snapshot.month;
    }
    return { net: assets - liabilities, latest };
  }, [latestByAccount, accountKind]);

  const netWorthSeries = useMemo(() => {
    const inRange = new Set(netMonths);
    const byMonth = new Map<string, number>();
    for (const balance of balances) {
      if (!inRange.has(balance.month)) continue;
      const kind = accountKind.get(balance.account_id);
      if (!kind) continue;
      const delta = kind === "loan" ? -balance.balance : balance.balance;
      byMonth.set(balance.month, (byMonth.get(balance.month) ?? 0) + delta);
    }
    return netMonths
      .filter((month) => byMonth.has(month))
      .map((month) => ({ key: month, label: shortLabel(month), net: byMonth.get(month) ?? 0 }));
  }, [balances, netMonths, accountKind]);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Track spending, cash flow, category weight, and net worth history."
      >
        <div className="flex items-center rounded-lg border bg-muted/40 p-0.5">
          {PERIODS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => setPeriod(entry.key)}
              className={cn(
                "rounded-md px-3 py-1 text-sm transition-colors",
                period === entry.key
                  ? "bg-background font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {entry.key}
            </button>
          ))}
        </div>
      </PageHeader>

      <div className="space-y-4 p-4 md:p-8">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            label="Income"
            value={money(rangeIncome)}
            caption={rangeLabel(flowMonths)}
            tone="positive"
            icon={<TrendingUp className="size-4" />}
          />
          <SummaryCard
            label="Expenses"
            value={money(rangeExpense)}
            caption={rangeLabel(flowMonths)}
            tone="negative"
            icon={<TrendingDown className="size-4" />}
          />
          <SummaryCard
            label="Net cash flow"
            value={money(netCashFlow)}
            caption="Income minus expenses"
            tone={netCashFlow >= 0 ? "positive" : "negative"}
            icon={<ArrowLeftRight className="size-4" />}
          />
          <SummaryCard
            label="Net worth"
            value={money(netWorth.net)}
            caption={netWorth.latest ? `as of ${monthLabel(netWorth.latest)}` : "No account balances yet"}
            tone="accent"
            icon={<ChartLine className="size-4" />}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <ChartCard title="Spending trend" icon={<TrendingUp className="size-4" />}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="spendingFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={EXPENSE} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={EXPENSE} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} width={56} tickFormatter={(value) => money(Number(value))} />
                <Tooltip formatter={(value) => money(Number(value))} labelFormatter={(_, payload) => monthOf(payload)} />
                <Area type="monotone" dataKey="expense" stroke={EXPENSE} strokeWidth={2} fill="url(#spendingFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Income vs expenses" icon={<BarChart3 className="size-4" />}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={compareData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} width={56} tickFormatter={(value) => money(Number(value))} />
                <Tooltip formatter={(value) => money(Number(value))} labelFormatter={(_, payload) => monthOf(payload)} />
                <Bar dataKey="income" fill={INCOME} radius={[3, 3, 0, 0]} />
                <Bar dataKey="expense" fill={EXPENSE} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Spending by category" icon={<ChartPie className="size-4" />}>
            {categoryData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryData} layout="vertical" margin={{ left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                  <XAxis type="number" tickLine={false} axisLine={false} fontSize={12} tickFormatter={(value) => money(Number(value))} />
                  <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} fontSize={12} width={110} />
                  <Tooltip formatter={(value) => money(Number(value))} />
                  <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                    {categoryData.map((row) => (
                      <Cell key={row.name} fill={row.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState>No spending in this period.</EmptyState>
            )}
          </ChartCard>

          <ChartCard title="Net worth over time" icon={<ChartLine className="size-4" />}>
            {netWorthSeries.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={netWorthSeries}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis tickLine={false} axisLine={false} fontSize={12} width={56} tickFormatter={(value) => money(Number(value))} />
                  <Tooltip formatter={(value) => money(Number(value))} labelFormatter={(_, payload) => monthOf(payload)} />
                  <Line type="monotone" dataKey="net" stroke={ACCENT} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState>No recorded account balances in this period.</EmptyState>
            )}
          </ChartCard>
        </div>
      </div>
    </>
  );
}

function monthOf(payload: unknown) {
  const list = payload as { payload?: { key?: string } }[] | undefined;
  const key = list?.[0]?.payload?.key;
  return key ? monthLabel(key) : "";
}

function SummaryCard({
  label,
  value,
  caption,
  icon,
  tone,
}: {
  label: string;
  value: string;
  caption: string;
  icon: ReactNode;
  tone: "positive" | "negative" | "accent";
}) {
  return (
    <Card
      className={cn(
        "border-l-4",
        tone === "negative" && "border-l-rose-500",
        tone === "positive" && "border-l-emerald-500",
        tone === "accent" && "border-l-primary"
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">{icon}</span>
        </div>
        <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{caption}</div>
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-full bg-muted text-muted-foreground">{icon}</span>
          <h2 className="text-sm font-semibold">{title}</h2>
        </div>
        <div className="h-64 w-full">{children}</div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="grid h-full place-items-center text-sm text-muted-foreground">{children}</div>;
}
