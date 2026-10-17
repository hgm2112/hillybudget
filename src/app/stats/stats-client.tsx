"use client";

import { useMemo, useState } from "react";
import { money } from "@/lib/money";
import { monthLabel } from "@/lib/month";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from "recharts";

type Category = { id: string; name: string; color: string; kind: "expense" | "income" };
type Entry = { month: string; category_id: string; amount: number };

const INCOME = "#10b981";
const EXPENSE = "#ef4444";
const ACCENT = "#d85700";

export function StatsClient({
  categories,
  entries,
  defaultMonth,
}: {
  categories: Category[];
  entries: Entry[];
  defaultMonth: string;
}) {
  const [period, setPeriod] = useState<"month" | "year" | "all">("year");
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);

  const categoryMap = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const kindById = useMemo(() => new Map(categories.map((category) => [category.id, category.kind])), [categories]);

  const expenseEntries = useMemo(
    () => entries.filter((entry) => kindById.get(entry.category_id) === "expense"),
    [entries, kindById]
  );
  const incomeEntries = useMemo(
    () => entries.filter((entry) => kindById.get(entry.category_id) === "income"),
    [entries, kindById]
  );

  const filteredEntries = useMemo(() => {
    return expenseEntries.filter((entry) => {
      if (period === "month") return entry.month === selectedMonth;
      if (period === "year") return entry.month.startsWith(selectedMonth.slice(0, 4));
      return true;
    });
  }, [expenseEntries, period, selectedMonth]);

  const categoryShares = useMemo(() => {
    const map = new Map<string, number>();
    filteredEntries.forEach((entry) => {
      map.set(entry.category_id, (map.get(entry.category_id) ?? 0) + entry.amount);
    });
    const total = [...map.values()].reduce((sum, value) => sum + value, 0);
    return [...map.entries()]
      .map(([categoryId, amount]) => {
        const category = categoryMap.get(categoryId);
        return {
          id: categoryId,
          name: category?.name ?? "Unknown",
          color: category?.color ?? "#6b7280",
          amount,
          percent: total ? (amount / total) * 100 : 0,
        };
      })
      .sort((a, b) => b.amount - a.amount);
  }, [filteredEntries, categoryMap]);

  const months = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((entry) => set.add(entry.month));
    return [...set].sort().slice(-24);
  }, [entries]);

  const monthlyChart = useMemo(() => {
    return months
      .filter((month) => (period === "year" ? month.startsWith(selectedMonth.slice(0, 4)) : true))
      .map((month) => {
        const expenses = expenseEntries
          .filter((entry) => entry.month === month)
          .reduce((sum, entry) => sum + entry.amount, 0);
        const income = incomeEntries
          .filter((entry) => entry.month === month)
          .reduce((sum, entry) => sum + entry.amount, 0);
        return { month: monthLabel(month), income, expenses, net: income - expenses };
      });
  }, [months, expenseEntries, incomeEntries, period, selectedMonth]);

  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h1 className="text-2xl font-semibold">Stats</h1>
        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={(value) => setPeriod(value as typeof period)}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="month">Month</SelectItem>
              <SelectItem value="year">Year</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
          {period !== "all" && <InputDate value={selectedMonth} onChange={setSelectedMonth} period={period} />}
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <h2 className="mb-3 text-lg font-semibold">Expense share by category</h2>
          <div className="space-y-2">
            {categoryShares.map((share) => (
              <div key={share.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: share.color }} />
                  <span>{share.name}</span>
                </div>
                <span className="tabular-nums">{money(share.amount)}</span>
                <div className="flex items-center justify-end gap-2">
                  <div className="h-2 w-24 overflow-hidden rounded bg-muted">
                    <div className="h-full" style={{ width: `${Math.abs(share.percent)}%`, backgroundColor: share.color }} />
                  </div>
                  <span className="w-16 text-right tabular-nums">{share.percent.toFixed(1)}%</span>
                </div>
              </div>
            ))}
            {categoryShares.length === 0 && <p className="text-sm text-muted-foreground">No data for this period.</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h2 className="mb-3 text-lg font-semibold">Income vs expenses (monthly)</h2>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="income" fill={INCOME} />
                <Bar dataKey="expenses" fill={EXPENSE} />
                <Bar dataKey="net" fill={ACCENT} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function InputDate({
  value,
  onChange,
  period,
}: {
  value: string;
  onChange: (value: string) => void;
  period: "month" | "year" | "all";
}) {
  if (period === "year") {
    return (
      <input
        type="number"
        value={value.slice(0, 4)}
        onChange={(e) => onChange(e.target.value + "-01-01")}
        className="h-9 rounded-md border bg-background px-3 text-sm"
      />
    );
  }
  return (
    <input
      type="month"
      value={value.slice(0, 7)}
      onChange={(e) => onChange(e.target.value + "-01")}
      className="h-9 rounded-md border bg-background px-3 text-sm"
    />
  );
}
