"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/money";
import { monthLabel, shiftMonth, toMonthKey } from "@/lib/month";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Account = {
  id: string;
  household_id: string;
  name: string;
  type: "liquid" | "retirement" | "loan";
  color: string;
  sort_order: number;
  archived: boolean;
  original_amount: number | null;
  interest_rate: number | null;
  monthly_payment: number | null;
  start_date: string | null;
};

type Balance = {
  id: string;
  household_id: string;
  account_id: string;
  month: string;
  balance: number;
  contributions: number | null;
};

const PALETTE = ["#3b82f6", "#22c55e", "#f97316", "#8b5cf6", "#ef4444", "#14b8a6", "#eab308", "#ec4899", "#64748b"];

export default function AccountsPage() {
  const router = useRouter();
  const supabase = createClient();

  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [month, setMonth] = useState(() => (typeof window === "undefined" ? "" : toMonthKey(new Date())));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newAccount, setNewAccount] = useState({
    name: "",
    type: "liquid" as Account["type"],
    color: PALETTE[0],
    original_amount: "",
    interest_rate: "",
    monthly_payment: "",
    start_date: "",
  });
  const [archived, setArchived] = useState(false);

  async function loadBase(hid: string) {
    const [{ data: accountData }, { data: balanceData }] = await Promise.all([
      supabase.from("accounts").select("*").eq("household_id", hid).order("sort_order"),
      supabase.from("account_balances").select("*").eq("household_id", hid),
    ]);
    setAccounts(((accountData ?? []) as Account[]).map((account) => ({
      ...account,
      original_amount: account.original_amount === null ? null : Number(account.original_amount),
      interest_rate: account.interest_rate === null ? null : Number(account.interest_rate),
      monthly_payment: account.monthly_payment === null ? null : Number(account.monthly_payment),
    })));
    setBalances(((balanceData ?? []) as Balance[]).map((balance) => ({ ...balance, balance: Number(balance.balance), contributions: balance.contributions === null ? null : Number(balance.contributions) })));
  }

  useEffect(() => {
    let active = true;
    async function init() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        router.replace("/login");
        return;
      }
      const { data: membership } = await supabase.from("household_members").select("household_id").eq("user_id", userData.user.id).limit(1).maybeSingle();
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

  useEffect(() => {
    const next: Record<string, string> = {};
    accounts.forEach((account) => {
      const current = balances.find((balance) => balance.account_id === account.id && balance.month === month);
      const previous = balances.find((balance) => balance.account_id === account.id && balance.month === shiftMonth(month, -1));
      next[account.id] = current ? String(current.balance) : previous ? String(previous.balance) : "";
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrafts(next);
  }, [accounts, balances, month]);

  const visibleAccounts = useMemo(() => accounts.filter((account) => !account.archived || archived), [accounts, archived]);
  const sortedVisible = useMemo(() => [...visibleAccounts].sort((a, b) => a.sort_order - b.sort_order), [visibleAccounts]);

  function monthTotal(type: Account["type"]) {
    return visibleAccounts
      .filter((account) => account.type === type)
      .reduce((sum, account) => {
        const draft = drafts[account.id];
        const value = draft === "" ? balanceFor(account.id, month)?.balance ?? 0 : Number(draft);
        return sum + (Number.isFinite(value) ? value : 0);
      }, 0);
  }

  function balanceFor(accountId: string, targetMonth: string) {
    return balances.find((balance) => balance.account_id === accountId && balance.month === targetMonth);
  }

  async function saveBalance(accountId: string) {
    if (!householdId) return;
    const value = Number(drafts[accountId]);
    if (!Number.isFinite(value)) return;
    const existing = balanceFor(accountId, month);
    if (existing) {
      await supabase.from("account_balances").update({ balance: value }).eq("id", existing.id);
    } else {
      await supabase.from("account_balances").insert({ household_id: householdId, account_id: accountId, month, balance: value });
    }
    await loadBase(householdId);
  }

  async function saveAllBalances() {
    if (!householdId) return;
    for (const account of sortedVisible) {
      await saveBalance(account.id);
    }
  }

  async function addAccount(event: React.FormEvent) {
    event.preventDefault();
    if (!householdId || !newAccount.name.trim()) return;
    await supabase.from("accounts").insert({
      household_id: householdId,
      name: newAccount.name.trim(),
      type: newAccount.type,
      color: newAccount.color,
      sort_order: accounts.length,
      archived: false,
      original_amount: newAccount.original_amount === "" ? null : Number(newAccount.original_amount),
      interest_rate: newAccount.interest_rate === "" ? null : Number(newAccount.interest_rate),
      monthly_payment: newAccount.monthly_payment === "" ? null : Number(newAccount.monthly_payment),
      start_date: newAccount.start_date || null,
    });
    setNewAccount({ name: "", type: "liquid", color: PALETTE[(accounts.length + 1) % PALETTE.length], original_amount: "", interest_rate: "", monthly_payment: "", start_date: "" });
    await loadBase(householdId);
  }

  async function archiveAccount(account: Account) {
    if (!householdId) return;
    await supabase.from("accounts").update({ archived: !account.archived }).eq("id", account.id);
    await loadBase(householdId);
  }

  async function deleteAccount(account: Account) {
    if (!householdId) return;
    await supabase.from("accounts").delete().eq("id", account.id);
    await loadBase(householdId);
  }

  function projectedPayoff(account: Account) {
    const principal = Number(drafts[account.id] ?? 0);
    if (!account.monthly_payment || !account.interest_rate || !Number.isFinite(principal) || principal <= 0) return null;
    const rate = account.interest_rate / 100 / 12;
    let balance = principal;
    let months = 0;
    while (balance > 0 && months < 1200) {
      const interest = balance * rate;
      balance += interest - account.monthly_payment;
      months += 1;
      if (months > 1200) return null;
    }
    if (balance > 0) return null;
    const date = new Date(month + "T00:00:00Z");
    date.setUTCMonth(date.getUTCMonth() + months);
    return date.toISOString().slice(0, 7);
  }

  const liquidTotal = monthTotal("liquid");
  const retirementTotal = monthTotal("retirement");
  const debtTotal = monthTotal("loan");
  const netWorth = liquidTotal + retirementTotal - debtTotal;
  const previousLiquid = visibleAccounts.filter((account) => account.type === "liquid").reduce((sum, account) => sum + (balanceFor(account.id, shiftMonth(month, -1))?.balance ?? 0), 0);
  const previousRetirement = visibleAccounts.filter((account) => account.type === "retirement").reduce((sum, account) => sum + (balanceFor(account.id, shiftMonth(month, -1))?.balance ?? 0), 0);
  const previousDebt = visibleAccounts.filter((account) => account.type === "loan").reduce((sum, account) => sum + (balanceFor(account.id, shiftMonth(month, -1))?.balance ?? 0), 0);
  const previousNet = previousLiquid + previousRetirement - previousDebt;

  if (!householdId || !month) return <main className="p-8">Loading...</main>;

  return (
    <main className="mx-auto max-w-7xl p-4 md:p-8 space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Accounts</h1>
          <p className="text-sm text-muted-foreground">{monthLabel(month)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setMonth(shiftMonth(month, -1))}>Previous</Button>
          <Button variant="outline" onClick={() => setMonth(toMonthKey(new Date()))}>This month</Button>
          <Button variant="outline" onClick={() => setMonth(shiftMonth(month, 1))}>Next</Button>
          <Button onClick={saveAllBalances}>Save balances</Button>
          <Button variant="outline" onClick={() => setArchived((value) => !value)}>{archived ? "Hide archived" : "Show archived"}</Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Liquid</div><div className="text-lg font-semibold tabular-nums">{money(liquidTotal)}</div><div className="text-xs text-muted-foreground">change {money(liquidTotal - previousLiquid)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Retirement</div><div className="text-lg font-semibold tabular-nums">{money(retirementTotal)}</div><div className="text-xs text-muted-foreground">change {money(retirementTotal - previousRetirement)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Debt</div><div className="text-lg font-semibold tabular-nums">{money(debtTotal)}</div><div className="text-xs text-muted-foreground">change {money(debtTotal - previousDebt)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Net worth</div><div className="text-lg font-semibold tabular-nums">{money(netWorth)}</div><div className="text-xs text-muted-foreground">change {money(netWorth - previousNet)}</div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Balances for {monthLabel(month)}</h2>
            <span className="text-sm text-muted-foreground">Enter one balance per account</span>
          </div>
          <div className="space-y-2">
            {sortedVisible.map((account) => {
              const current = drafts[account.id] ?? "";
              const previousBalance = balanceFor(account.id, shiftMonth(month, -1))?.balance ?? 0;
              const value = Number(current);
              const change = Number.isFinite(value) ? value - previousBalance : 0;
              const percent = previousBalance ? (change / previousBalance) * 100 : 0;
              return (
                <div key={account.id} className="grid gap-2 md:grid-cols-[2fr_1fr_1fr_auto]">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: account.color }} />
                    <span className="font-medium">{account.name}</span>
                    <Badge variant="secondary">{account.type}</Badge>
                    {account.archived && <Badge>archived</Badge>}
                  </div>
                  <Input
                    value={current}
                    onChange={(e) => setDrafts((state) => ({ ...state, [account.id]: e.target.value }))}
                    placeholder={previousBalance ? String(previousBalance) : "0.00"}
                    inputMode="decimal"
                    className="tabular-nums"
                  />
                  <div className="text-sm tabular-nums">
                    <span className={change >= 0 ? "text-green-600" : "text-red-600"}>
                      {change >= 0 ? "+" : ""}{money(change)} ({percent.toFixed(2)}%)
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => saveBalance(account.id)}>Save</Button>
                    <Button size="sm" variant="outline" onClick={() => archiveAccount(account)}>{account.archived ? "Unarchive" : "Archive"}</Button>
                    <Button size="sm" variant="outline" onClick={() => deleteAccount(account)}>Delete</Button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {sortedVisible.filter((account) => account.type === "loan").map((account) => {
        const current = Number(drafts[account.id] ?? 0);
        const original = account.original_amount ?? 0;
        const principalPaid = original > 0 ? original - (Number.isFinite(current) ? current : 0) : null;
        const percentPaid = original > 0 ? ((original - (Number.isFinite(current) ? current : 0)) / original) * 100 : null;
        const payoff = projectedPayoff(account);
        return (
          <Card key={`loan-${account.id}`}>
            <CardContent className="p-4">
              <h2 className="text-lg font-semibold">{account.name} (loan)</h2>
              <div className="mt-2 grid gap-2 md:grid-cols-4">
                <div><span className="text-xs text-muted-foreground">Remaining</span><div>{money(Number.isFinite(current) ? current : 0)}</div></div>
                <div><span className="text-xs text-muted-foreground">Original</span><div>{original ? money(original) : "-"}</div></div>
                <div><span className="text-xs text-muted-foreground">Principal paid</span><div>{principalPaid !== null ? money(principalPaid) : "-"}</div></div>
                <div><span className="text-xs text-muted-foreground">Percent paid</span><div>{percentPaid !== null ? `${percentPaid.toFixed(2)}%` : "-"}</div></div>
              </div>
              {payoff && <p className="mt-2 text-sm text-muted-foreground">Projected payoff: {payoff}</p>}
              <div className="mt-3 grid gap-2 md:grid-cols-4">
                <div><Label>Original amount</Label><Input defaultValue={account.original_amount ?? ""} onBlur={(e) => { if (householdId) supabase.from("accounts").update({ original_amount: e.target.value === "" ? null : Number(e.target.value) }).eq("id", account.id).then(() => loadBase(householdId)); }} className="tabular-nums" /></div>
                <div><Label>Interest rate (%)</Label><Input defaultValue={account.interest_rate ?? ""} onBlur={(e) => { if (householdId) supabase.from("accounts").update({ interest_rate: e.target.value === "" ? null : Number(e.target.value) }).eq("id", account.id).then(() => loadBase(householdId)); }} className="tabular-nums" /></div>
                <div><Label>Monthly payment</Label><Input defaultValue={account.monthly_payment ?? ""} onBlur={(e) => { if (householdId) supabase.from("accounts").update({ monthly_payment: e.target.value === "" ? null : Number(e.target.value) }).eq("id", account.id).then(() => loadBase(householdId)); }} className="tabular-nums" /></div>
                <div><Label>Start date</Label><Input type="date" defaultValue={account.start_date ?? ""} onBlur={(e) => { if (householdId) supabase.from("accounts").update({ start_date: e.target.value || null }).eq("id", account.id).then(() => loadBase(householdId)); }} /></div>
              </div>
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardContent className="p-4">
          <h2 className="text-lg font-semibold mb-3">Add account</h2>
          <form onSubmit={addAccount} className="grid gap-2 md:grid-cols-4">
            <div><Label>Name</Label><Input value={newAccount.name} onChange={(e) => setNewAccount((state) => ({ ...state, name: e.target.value }))} required /></div>
            <div><Label>Type</Label><select value={newAccount.type} onChange={(e) => setNewAccount((state) => ({ ...state, type: e.target.value as Account["type"] }))} className="h-9 w-full rounded-md border bg-background px-2 text-sm"><option value="liquid">liquid</option><option value="retirement">retirement</option><option value="loan">loan</option></select></div>
            <div><Label>Color</Label><Input type="color" value={newAccount.color} onChange={(e) => setNewAccount((state) => ({ ...state, color: e.target.value }))} /></div>
            <div><Label>Order</Label><Input value={String(accounts.length)} disabled /></div>
            {newAccount.type === "loan" && (
              <>
                <div><Label>Original amount</Label><Input value={newAccount.original_amount} onChange={(e) => setNewAccount((state) => ({ ...state, original_amount: e.target.value }))} className="tabular-nums" /></div>
                <div><Label>Interest rate (%)</Label><Input value={newAccount.interest_rate} onChange={(e) => setNewAccount((state) => ({ ...state, interest_rate: e.target.value }))} className="tabular-nums" /></div>
                <div><Label>Monthly payment</Label><Input value={newAccount.monthly_payment} onChange={(e) => setNewAccount((state) => ({ ...state, monthly_payment: e.target.value }))} className="tabular-nums" /></div>
                <div><Label>Start date</Label><Input type="date" value={newAccount.start_date} onChange={(e) => setNewAccount((state) => ({ ...state, start_date: e.target.value }))} /></div>
              </>
            )}
            <div className="md:col-span-4"><Button type="submit">Add account</Button></div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
