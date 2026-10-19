"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moneyWhole } from "@/lib/money";
import { monthLabel, monthName } from "@/lib/month";
import { MonthNav } from "@/components/month-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { addAccount, archiveAccount, clearBalances, deleteAccount, saveBalances, skipMonth, unarchiveAccount, unskipMonth, type ActionResult, type AccountKind } from "./actions";
import { cn } from "cn";

type Account = {
  id: string;
  name: string;
  kind: AccountKind;
  color: string;
  sort_order: number;
};

type Balance = { id: string; account_id: string; month: string; balance: number };

const PALETTE = ["#d85700", "#f2a65a", "#8c3b00", "#b8865a", "#6b7280", "#9ca3af", "#4b5563", "#d1a37a"];

function parseBalance(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.-]/g, "");
  if (cleaned.trim() === "") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export function AccountsClient({
  accounts,
  balances,
  skipped,
  archivedIds,
  month,
  months,
}: {
  accounts: Account[];
  balances: Balance[];
  skipped: string[];
  archivedIds: string[];
  month: string;
  months: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [showArchived, setShowArchived] = useState(false);
  const [clearArmed, setClearArmed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newAccount, setNewAccount] = useState({
    name: "",
    kind: "liquid" as AccountKind,
    color: PALETTE[0],
  });

  const isSkipped = skipped.includes(month);
  const hasBalances = balances.some((balance) => balance.month === month);
  const seededMonth = useRef<string | null>(null);

  const isArchived = useCallback(
    (accountId: string) => archivedIds.includes(accountId),
    [archivedIds]
  );

  const previousRecordedMonth = useCallback(
    (targetMonth: string) => {
      let best: string | null = null;
      for (const balance of balances) {
        if (balance.month < targetMonth && (best === null || balance.month > best)) best = balance.month;
      }
      return best;
    },
    [balances]
  );

  useEffect(() => {
    if (isSkipped) {
      seededMonth.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDrafts({});
      return;
    }
    if (seededMonth.current === month) {
      setDrafts((previous) => {
        let changed = false;
        const next = { ...previous };
        for (const account of accounts) {
          if (!(account.id in next)) {
            next[account.id] = "";
            changed = true;
          }
        }
        return changed ? next : previous;
      });
      return;
    }
    seededMonth.current = month;
    const next: Record<string, string> = {};
    for (const account of accounts) {
      const current = balances.find((balance) => balance.account_id === account.id && balance.month === month);
      next[account.id] = current ? String(current.balance) : "";
    }
    setDrafts(next);
  }, [accounts, balances, month, isSkipped]);

  const activeAccounts = useMemo(
    () => accounts.filter((account) => !isArchived(account.id)),
    [accounts, isArchived]
  );
  const visibleAccounts = useMemo(
    () => accounts.filter((account) => !isArchived(account.id) || showArchived),
    [accounts, isArchived, showArchived]
  );
  const sortedVisible = useMemo(
    () => [...visibleAccounts].sort((a, b) => a.sort_order - b.sort_order),
    [visibleAccounts]
  );

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function run(promise: Promise<ActionResult>) {
    setError(null);
    const result = await promise;
    if (result?.error) {
      setError(result.error);
      return false;
    }
    refresh();
    return true;
  }

  function goToMonth(nextMonth: string) {
    startTransition(() => router.push(`/accounts?month=${nextMonth}`));
  }

  function balanceFor(accountId: string, targetMonth: string) {
    return balances.find((balance) => balance.account_id === accountId && balance.month === targetMonth);
  }

  function savedFor(accountId: string) {
    return balanceFor(accountId, month)?.balance;
  }

  function currentValueFor(accountId: string): number | null {
    const raw = drafts[accountId];
    if (raw !== undefined && raw.trim() !== "") {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : null;
    }
    const saved = savedFor(accountId);
    return saved === undefined ? null : saved;
  }

  function monthTotal(kind: AccountKind) {
    return activeAccounts
      .filter((account) => account.kind === kind)
      .reduce((sum, account) => sum + (savedFor(account.id) ?? 0), 0);
  }

  function saveBalance(accountId: string) {
    const raw = drafts[accountId];
    if (raw === undefined || raw.trim() === "") return;
    const value = parseBalance(raw);
    if (value === null) {
      setError("Enter a valid number.");
      return;
    }
    run(saveBalances(month, [{ accountId, balance: value }]));
  }

  function saveAllBalances() {
    const items: { accountId: string; balance: number }[] = [];
    for (const account of sortedVisible) {
      const raw = drafts[account.id];
      if (raw === undefined || raw.trim() === "") continue;
      const value = parseBalance(raw);
      if (value === null) {
        setError("Enter a valid number.");
        return;
      }
      items.push({ accountId: account.id, balance: value });
    }
    if (items.length === 0) return;
    run(saveBalances(month, items));
  }

  async function submitAccount(event: React.FormEvent) {
    event.preventDefault();
    const ok = await run(
      addAccount({
        name: newAccount.name,
        kind: newAccount.kind,
        color: newAccount.color,
      })
    );
    if (ok) {
      setNewAccount({
        name: "",
        kind: "liquid",
        color: PALETTE[(accounts.length + 1) % PALETTE.length],
      });
    }
  }

  const liquidTotal = monthTotal("liquid");
  const retirementTotal = monthTotal("retirement");
  const debtTotal = monthTotal("loan");
  const netWorth = liquidTotal + retirementTotal - debtTotal;
  const prevMonth = previousRecordedMonth(month);
  const previousLiquid = activeAccounts
    .filter((account) => account.kind === "liquid")
    .reduce((sum, account) => sum + (balanceFor(account.id, prevMonth ?? "")?.balance ?? 0), 0);
  const previousRetirement = activeAccounts
    .filter((account) => account.kind === "retirement")
    .reduce((sum, account) => sum + (balanceFor(account.id, prevMonth ?? "")?.balance ?? 0), 0);
  const previousDebt = activeAccounts
    .filter((account) => account.kind === "loan")
    .reduce((sum, account) => sum + (balanceFor(account.id, prevMonth ?? "")?.balance ?? 0), 0);
  const previousNet = previousLiquid + previousRetirement - previousDebt;

  function changeText(current: number, previous: number) {
    if (!hasBalances) return "no saved data";
    if (!prevMonth) return "first snapshot";
    return `change ${moneyWhole(current - previous)}`;
  }

  return (
    <>
      <div className="relative grid grid-cols-1 items-center gap-3 lg:grid-cols-[1fr_auto_1fr]">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Accounts</h1>
          {isPending && <span className="text-sm text-muted-foreground">updating…</span>}
        </div>
        <div className="flex justify-center">
          <MonthNav value={month} months={months} onSelect={goToMonth} />
        </div>
        <div className="flex items-center justify-end">
          {hasBalances && prevMonth && (
            <span className="text-sm text-muted-foreground">Changes vs {monthName(prevMonth)}</span>
          )}
        </div>
      </div>

      <div className="space-y-6">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div inert={isSkipped} className={cn("grid gap-3 md:grid-cols-4", isSkipped && "opacity-40")}>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Liquid</div><div className="text-lg font-semibold tabular-nums">{moneyWhole(liquidTotal)}</div><div className="text-xs text-muted-foreground">{changeText(liquidTotal, previousLiquid)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Retirement</div><div className="text-lg font-semibold tabular-nums">{moneyWhole(retirementTotal)}</div><div className="text-xs text-muted-foreground">{changeText(retirementTotal, previousRetirement)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Debt</div><div className="text-lg font-semibold tabular-nums">{moneyWhole(debtTotal)}</div><div className="text-xs text-muted-foreground">{changeText(debtTotal, previousDebt)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Net worth</div><div className="text-lg font-semibold tabular-nums">{moneyWhole(netWorth)}</div><div className="text-xs text-muted-foreground">{changeText(netWorth, previousNet)}</div></CardContent></Card>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="outline" onClick={saveAllBalances} disabled={isSkipped}>Save balances</Button>
        {!isSkipped && (
          <Button variant="outline" onClick={() => run(skipMonth(month))}>Skip this month</Button>
        )}
        {hasBalances &&
          (clearArmed === month ? (
            <>
              <Button
                variant="outline"
                className="text-red-600"
                onClick={() => {
                  setClearArmed(null);
                  run(clearBalances(month));
                }}
              >
                Confirm clear
              </Button>
              <Button variant="outline" onClick={() => setClearArmed(null)}>Cancel</Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => setClearArmed(month)}>Clear balances</Button>
          ))}
        <Button variant="outline" onClick={() => setShowArchived((value) => !value)}>
          {showArchived ? "Hide archived" : "Show archived"}
        </Button>
      </div>

      <Card className="relative">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Balances for {monthLabel(month)}</h2>
            <span className="text-sm text-muted-foreground">Enter one balance per account</span>
          </div>
          <div className={cn("space-y-2", isSkipped && "opacity-40")}>
            {(["liquid", "retirement", "loan"] as AccountKind[])
              .map((kind) => sortedVisible.filter((account) => account.kind === kind))
              .filter((group) => group.length > 0)
              .map((group, index) => (
                <Fragment key={group[0].kind}>
                  {index > 0 && <div className="border-t border-border" />}
                  {group.map((account) => {
                    const current = drafts[account.id] ?? "";
                    const previousBalance = balanceFor(account.id, prevMonth ?? "")?.balance ?? null;
                    const value = currentValueFor(account.id);
                    const change = value !== null && previousBalance !== null ? value - previousBalance : null;
                    const percent = change !== null && previousBalance ? (change / previousBalance) * 100 : 0;
                    const improving = change !== null && (account.kind === "loan" ? change <= 0 : change >= 0);
                    return (
                      <div key={account.id} className="grid gap-2 md:grid-cols-[2fr_1fr_1fr_auto]">
                        <div className="flex items-center gap-2">
                          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: account.color }} />
                          <span className="font-medium">{account.name}</span>
                          <Badge variant="secondary">{account.kind}</Badge>
                          {isArchived(account.id) && <Badge>archived</Badge>}
                        </div>
                        <Input
                          value={current}
                          onChange={(e) => setDrafts((state) => ({ ...state, [account.id]: e.target.value }))}
                          placeholder={isSkipped ? "" : previousBalance ? String(previousBalance) : "0.00"}
                          inputMode="decimal"
                          disabled={isSkipped}
                          className="tabular-nums"
                        />
                        <div className="text-sm tabular-nums">
                          {!isSkipped && change !== null ? (
                            <span className={improving ? "text-green-600" : "text-red-600"}>
                              {change >= 0 ? "+" : ""}{moneyWhole(change)} ({percent.toFixed(2)}%)
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" disabled={current.trim() === ""} onClick={() => saveBalance(account.id)}>Save</Button>
                          <Button size="sm" variant="outline" onClick={() => run(isArchived(account.id) ? unarchiveAccount(account.id, month) : archiveAccount(account.id, month))}>
                            {isArchived(account.id) ? "Unarchive" : "Archive"}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => run(deleteAccount(account.id))}>Delete</Button>
                        </div>
                      </div>
                    );
                  })}
                </Fragment>
              ))}
          </div>
          {isSkipped && (
            <div className="absolute inset-0 grid place-items-center">
              <div className="flex flex-col items-center gap-3 rounded-xl border bg-background/80 px-8 py-10 text-center shadow-sm backdrop-blur-sm">
                <p className="text-2xl font-semibold text-muted-foreground">No data this month</p>
                <Button variant="outline" onClick={() => run(unskipMonth(month))}>Undo skip</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div inert={isSkipped} className={cn(isSkipped && "opacity-40")}>
      <Card>
        <CardContent className="p-4">
          <h2 className="mb-3 text-lg font-semibold">Add account</h2>
          <form onSubmit={submitAccount} className="grid gap-2 md:grid-cols-4">
            <div>
              <Label>Name</Label>
              <Input value={newAccount.name} onChange={(e) => setNewAccount((state) => ({ ...state, name: e.target.value }))} required />
            </div>
            <div>
              <Label>Type</Label>
              <select
                value={newAccount.kind}
                onChange={(e) => setNewAccount((state) => ({ ...state, kind: e.target.value as AccountKind }))}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                <option value="liquid">liquid</option>
                <option value="retirement">retirement</option>
                <option value="loan">loan</option>
              </select>
            </div>
            <div>
              <Label>Color</Label>
              <Input type="color" value={newAccount.color} onChange={(e) => setNewAccount((state) => ({ ...state, color: e.target.value }))} />
            </div>
            <div>
              <Label>Order</Label>
              <Input value={String(accounts.length)} disabled />
            </div>
            <div className="md:col-span-4"><Button type="submit">Add account</Button></div>
          </form>
        </CardContent>
      </Card>
      </div>
      </div>
    </>
  );
}
