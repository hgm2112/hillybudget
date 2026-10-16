"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { resolveHousehold } from "@/lib/household";
import { money } from "@/lib/money";
import { monthLabel } from "@/lib/month";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from "recharts";

type Category = { id: string; name: string; color: string; type: "expense" | "income" };
type Entry = { month: string; category_id: string; amount: number };
type IncomeItem = { month: string; amount: number };

export default function StatsPage() {
  const router = useRouter();
  const supabase = createClient();

  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [incomeItems, setIncomeItems] = useState<IncomeItem[]>([]);
  const [period, setPeriod] = useState<"month" | "year" | "all">("year");
  const [selectedMonth, setSelectedMonth] = useState(() => (typeof window === "undefined" ? "2026-01-01" : new Date().toISOString().slice(0, 7) + "-01"));

  async function loadBase(hid: string) {
    const [{ data: categoryData }, { data: entryData }, { data: incomeData }] = await Promise.all([
      supabase.from("categories").select("id,name,color,type").eq("household_id", hid),
      supabase.from("entries").select("month,category_id,amount").eq("household_id", hid),
      supabase.from("income").select("month,amount").eq("household_id", hid),
    ]);
    setCategories((categoryData ?? []) as Category[]);
    setEntries(((entryData ?? []) as Entry[]).map((entry) => ({ ...entry, amount: Number(entry.amount) })));
    setIncomeItems(((incomeData ?? []) as IncomeItem[]).map((item) => ({ ...item, amount: Number(item.amount) })));
  }

  useEffect(() => {
    let active = true;
    async function init() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        router.replace("/login");
        return;
      }
      const membership = await resolveHousehold(supabase, userData.user.id);
      if (!membership) {
        router.replace("/household");
        return;
      }
      if (!active) return;
      setHouseholdId(membership.household_id);
      await loadBase(membership.household_id);
    }
    init();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, supabase]);

  const categoryMap = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (period === "month") return entry.month === selectedMonth;
      if (period === "year") return entry.month.startsWith(selectedMonth.slice(0, 4));
      return true;
    });
  }, [entries, period, selectedMonth]);

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
          color: category?.color ?? "#9ca3af",
          type: category?.type ?? "expense",
          amount,
          percent: total ? (amount / total) * 100 : 0,
        };
      })
      .sort((a, b) => b.amount - a.amount);
  }, [filteredEntries, categoryMap]);

  const months = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((entry) => set.add(entry.month));
    incomeItems.forEach((item) => set.add(item.month));
    return [...set].sort().slice(-24);
  }, [entries, incomeItems]);

  const monthlyChart = useMemo(() => {
    return months
      .filter((month) => {
        if (period === "year") return month.startsWith(selectedMonth.slice(0, 4));
        return true;
      })
      .map((month) => {
        const expenses = entries.filter((entry) => entry.month === month).reduce((sum, entry) => sum + entry.amount, 0);
        const income = incomeItems.filter((item) => item.month === month).reduce((sum, item) => sum + item.amount, 0);
        return { month: monthLabel(month), income, expenses, net: income - expenses };
      });
  }, [months, entries, incomeItems, period, selectedMonth]);

  if (!householdId) return <main className="p-8">Loading...</main>;

  return (
    <main className="mx-auto max-w-7xl p-4 md:p-8 space-y-6">
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
          {period !== "all" && (
            <InputDate value={selectedMonth} onChange={setSelectedMonth} period={period} />
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <h2 className="text-lg font-semibold mb-3">Expense share by category</h2>
          <div className="space-y-2">
            {categoryShares.map((share) => (
              <div key={share.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: share.color }} />
                  <span>{share.name}</span>
                </div>
                <span className="tabular-nums">{money(share.amount)}</span>
                <div className="flex items-center gap-2 justify-end">
                  <div className="h-2 w-24 overflow-hidden rounded bg-muted"><div className="h-full" style={{ width: `${Math.abs(share.percent)}%`, backgroundColor: share.color }} /></div>
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
          <h2 className="text-lg font-semibold mb-3">Income vs expenses (monthly)</h2>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyChart}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="income" fill="#22c55e" />
                <Bar dataKey="expenses" fill="#ef4444" />
                <Bar dataKey="net" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

function InputDate({ value, onChange, period }: { value: string; onChange: (value: string) => void; period: "month" | "year" | "all" }) {
  if (period === "year") {
    return <input type="number" value={value.slice(0, 4)} onChange={(e) => onChange(e.target.value + "-01-01")} className="h-9 rounded-md border bg-background px-3 text-sm" />;
  }
  return <input type="month" value={value.slice(0, 7)} onChange={(e) => onChange(e.target.value + "-01")} className="h-9 rounded-md border bg-background px-3 text-sm" />;
}
