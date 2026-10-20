"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Check, MoreHorizontal, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { moneyWhole } from "@/lib/money";
import { monthLabel, monthName } from "@/lib/month";
import {
  carryForwardItems,
  deltaInfo,
  formatBalance,
  GROUP_ORDER,
  latestBalanceBefore,
  parseBalanceInput,
  payoffInfo,
  previousRecordedMonth,
  sharePercent,
  type Account,
  type AccountKind,
  type Balance,
  type DeltaInfo,
} from "@/lib/accounts";
import { MonthNav } from "@/components/month-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AccountDialog } from "./account-dialog";
import {
  archiveAccount,
  clearBalances,
  deleteAccount,
  saveBalances,
  skipMonth,
  unarchiveAccount,
  unskipMonth,
  type ActionResult,
} from "./actions";
import { cn } from "cn";

const GROUP_COLORS: Record<AccountKind, string> = {
  liquid: "#4A7BA3",
  retirement: "#7767A6",
  loan: "#D85700",
};

const GROUP_LABELS: Record<AccountKind, string> = {
  liquid: "Liquid",
  retirement: "Retirement",
  loan: "Loans",
};

const TONE_CLASSES: Record<"positive" | "negative" | "neutral", string> = {
  positive: "bg-[#10b981]/15 text-[#0f7a52] dark:bg-[#10b981]/20 dark:text-[#5ee0b0]",
  negative: "bg-[#ef4444]/12 text-[#b3261e] dark:bg-[#ef4444]/20 dark:text-[#fca5a5]",
  neutral: "bg-muted text-muted-foreground",
};

function ChangeChip({
  info,
  suffix,
  showPercent,
}: {
  info: DeltaInfo;
  suffix?: string;
  showPercent?: boolean;
}) {
  const tone = info.good === null ? "neutral" : info.good ? "positive" : "negative";
  const Icon = info.direction === "up" ? ArrowUp : info.direction === "down" ? ArrowDown : null;
  const percent = showPercent && info.percent !== null ? ` · ${info.percent.toFixed(1)}%` : "";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap tabular-nums", TONE_CLASSES[tone])}>
      {Icon && <Icon className="size-3" />}
      {info.delta >= 0 ? "+" : ""}
      {moneyWhole(info.delta)}
      {percent}
      {suffix ? <span className="font-normal opacity-70">{suffix}</span> : null}
    </span>
  );
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{description}</p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AccountsClient({
  householdId,
  accounts,
  balances,
  skipped,
  archivedIds,
  month,
  months,
}: {
  householdId: string;
  accounts: Account[];
  balances: Balance[];
  skipped: string[];
  archivedIds: string[];
  month: string;
  months: string[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [showArchived, setShowArchived] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogAccount, setDialogAccount] = useState<Account | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Account | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const isSkipped = skipped.includes(month);
  const hasBalances = balances.some((balance) => balance.month === month);

  const seededMonth = useRef<string | null>(null);
  const dirtyRef = useRef<Set<string>>(new Set());
  const focusedRef = useRef<string | null>(null);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const retryRef = useRef<(() => void) | null>(null);

  const isArchived = useCallback((accountId: string) => archivedIds.includes(accountId), [archivedIds]);

  const savedByAccount = useMemo(() => {
    const map = new Map<string, number>();
    for (const balance of balances) if (balance.month === month) map.set(balance.account_id, balance.balance);
    return map;
  }, [balances, month]);

  const prevMonth = useMemo(() => previousRecordedMonth(balances, month), [balances, month]);

  const prevMonthByAccount = useMemo(() => {
    const map = new Map<string, number>();
    if (!prevMonth) return map;
    for (const balance of balances) if (balance.month === prevMonth) map.set(balance.account_id, balance.balance);
    return map;
  }, [balances, prevMonth]);

  const previousByAccount = useMemo(() => {
    const map = new Map<string, number>();
    for (const account of accounts) {
      const value = latestBalanceBefore(balances, account.id, month);
      if (value !== null) map.set(account.id, value);
    }
    return map;
  }, [accounts, balances, month]);

  const activeAccounts = useMemo(() => accounts.filter((account) => !isArchived(account.id)), [accounts, isArchived]);
  const sortedVisible = useMemo(
    () =>
      accounts
        .filter((account) => !isArchived(account.id) || showArchived)
        .sort((a, b) => a.sort_order - b.sort_order),
    [accounts, isArchived, showArchived]
  );

  const currentValue = useCallback(
    (accountId: string): number | null => {
      const raw = drafts[accountId];
      if (raw !== undefined && raw.trim() !== "") return parseBalanceInput(raw);
      const saved = savedByAccount.get(accountId);
      return saved === undefined ? null : saved;
    },
    [drafts, savedByAccount]
  );

  useEffect(() => {
    const savedString = (accountId: string) => {
      const value = savedByAccount.get(accountId);
      return value === undefined ? "" : String(value);
    };
    if (isSkipped) {
      seededMonth.current = null;
      dirtyRef.current = new Set();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDrafts({});
      setStatus("idle");
      return;
    }
    if (seededMonth.current !== month) {
      seededMonth.current = month;
      dirtyRef.current = new Set();
      const next: Record<string, string> = {};
      for (const account of accounts) next[account.id] = savedString(account.id);
      setDrafts(next);
      setStatus("idle");
      return;
    }
    setDrafts((previous) => {
      let changed = false;
      const next = { ...previous };
      for (const account of accounts) {
        if (dirtyRef.current.has(account.id)) continue;
        if (focusedRef.current === account.id) continue;
        const value = savedString(account.id);
        if ((next[account.id] ?? "") !== value) {
          next[account.id] = value;
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [accounts, savedByAccount, month, isSkipped]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`balances:${householdId}:${month}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "account_balances", filter: `household_id=eq.${householdId}` },
        () => startTransition(() => router.refresh())
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [householdId, month, router, startTransition]);

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function run(promise: Promise<ActionResult>) {
    setError(null);
    const result = await promise;
    if (result?.error) {
      setError(result.error);
      return;
    }
    refresh();
  }

  const commit = useCallback(
    async (accountId: string) => {
      const raw = draftsRef.current[accountId] ?? "";
      if (raw.trim() === "") {
        dirtyRef.current.delete(accountId);
        return;
      }
      const parsed = parseBalanceInput(raw);
      if (parsed === null) {
        setError("Enter a valid number.");
        setStatus("error");
        retryRef.current = () => void commit(accountId);
        return;
      }
      const saved = savedByAccount.get(accountId);
      if (saved !== undefined && saved === parsed) {
        dirtyRef.current.delete(accountId);
        return;
      }
      setStatus("saving");
      setError(null);
      const result = await saveBalances(month, [{ accountId, balance: parsed }]);
      if (result?.error) {
        setError(result.error);
        setStatus("error");
        retryRef.current = () => void commit(accountId);
        return;
      }
      dirtyRef.current.delete(accountId);
      setStatus("idle");
      startTransition(() => router.refresh());
    },
    [month, savedByAccount, router, startTransition]
  );

  function focusNext(accountId: string) {
    const ids = sortedVisible.map((account) => account.id);
    const nextId = ids[ids.indexOf(accountId) + 1];
    if (nextId) document.getElementById(`balance-${nextId}`)?.focus();
  }

  function onInputChange(accountId: string, value: string) {
    dirtyRef.current.add(accountId);
    setDrafts((previous) => ({ ...previous, [accountId]: value }));
  }

  function onBlur(accountId: string) {
    focusedRef.current = null;
    const raw = draftsRef.current[accountId] ?? "";
    const parsed = raw.trim() === "" ? null : parseBalanceInput(raw);
    if (parsed !== null) {
      const formatted = formatBalance(parsed);
      if (formatted !== raw) setDrafts((previous) => ({ ...previous, [accountId]: formatted }));
    }
    void commit(accountId);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>, accountId: string) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void commit(accountId);
    focusNext(accountId);
  }

  async function carryForward() {
    const items = carryForwardItems(activeAccounts, balances, month).filter(
      (item) => (draftsRef.current[item.accountId] ?? "").trim() === ""
    );
    if (items.length === 0) return;
    setStatus("saving");
    setError(null);
    const result = await saveBalances(month, items);
    if (result?.error) {
      setError(result.error);
      setStatus("error");
      retryRef.current = () => void carryForward();
      return;
    }
    const next = { ...draftsRef.current };
    for (const item of items) {
      next[item.accountId] = formatBalance(item.balance);
      dirtyRef.current.delete(item.accountId);
    }
    setDrafts(next);
    setStatus("idle");
    startTransition(() => router.refresh());
  }

  function openCreate() {
    setDialogAccount(null);
    setDialogOpen(true);
  }

  function openEdit(account: Account) {
    setDialogAccount(account);
    setDialogOpen(true);
  }

  const groups = useMemo(
    () =>
      GROUP_ORDER.map((kind) => {
        const list = sortedVisible.filter((account) => account.kind === kind);
        const active = list.filter((account) => !isArchived(account.id));
        const total = active.reduce((sum, account) => sum + (currentValue(account.id) ?? 0), 0);
        const previousTotal = active.reduce((sum, account) => sum + (prevMonthByAccount.get(account.id) ?? 0), 0);
        return { kind, list, total, previousTotal, multi: active.length > 1 };
      }).filter((group) => group.list.length > 0),
    [sortedVisible, isArchived, currentValue, prevMonthByAccount]
  );

  const totals = useMemo(() => {
    const sum = (kind: AccountKind) =>
      activeAccounts.filter((account) => account.kind === kind).reduce((total, account) => total + (currentValue(account.id) ?? 0), 0);
    const prevSum = (kind: AccountKind) =>
      activeAccounts.filter((account) => account.kind === kind).reduce((total, account) => total + (prevMonthByAccount.get(account.id) ?? 0), 0);
    const liquid = sum("liquid");
    const retirement = sum("retirement");
    const debt = sum("loan");
    return {
      liquid,
      retirement,
      debt,
      net: liquid + retirement - debt,
      prevLiquid: prevSum("liquid"),
      prevRetirement: prevSum("retirement"),
      prevDebt: prevSum("loan"),
      prevNet: prevSum("liquid") + prevSum("retirement") - prevSum("loan"),
    };
  }, [activeAccounts, currentValue, prevMonthByAccount]);

  const summaries = [
    { key: "liquid", label: "Liquid", value: totals.liquid, previous: totals.prevLiquid, dot: GROUP_COLORS.liquid, kind: "liquid" as AccountKind },
    { key: "retirement", label: "Retirement", value: totals.retirement, previous: totals.prevRetirement, dot: GROUP_COLORS.retirement, kind: "retirement" as AccountKind },
    { key: "debt", label: "Debt", value: totals.debt, previous: totals.prevDebt, dot: GROUP_COLORS.loan, kind: "loan" as AccountKind },
    { key: "net", label: "Net worth", value: totals.net, previous: totals.prevNet, dot: "var(--foreground)", kind: "liquid" as AccountKind },
  ];

  function renderProgress(account: Account, group: { kind: AccountKind; total: number; multi: boolean }) {
    if (isArchived(account.id)) return null;
    if (account.kind === "loan") {
      const payoff = payoffInfo(currentValue(account.id) ?? 0, account.original_amount);
      if (!payoff) {
        return (
          <div className="flex justify-start">
            <button
              type="button"
              className="text-xs text-primary underline-offset-2 hover:underline"
              onClick={() => openEdit(account)}
            >
              Add original loan amount
            </button>
          </div>
        );
      }
      return (
        <div className="relative w-[62%]">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full" style={{ width: `${payoff.percent}%`, backgroundColor: GROUP_COLORS.loan }} />
          </div>
          <span className="absolute left-full top-1/2 -translate-y-1/2 ml-2 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
            {Math.round(payoff.percent)}% paid off · {moneyWhole(payoff.paid)}
          </span>
        </div>
      );
    }
    const value = currentValue(account.id);
    const share = value !== null ? sharePercent(value, group.total) : null;
    if (!group.multi || share === null) return null;
    return (
      <div className="relative w-[62%]">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full" style={{ width: `${share}%`, backgroundColor: GROUP_COLORS[account.kind] }} />
        </div>
        <span className="absolute left-full top-1/2 -translate-y-1/2 ml-2 text-xs whitespace-nowrap text-muted-foreground tabular-nums">{Math.round(share)}%</span>
      </div>
    );
  }

  function renderRow(account: Account, group: { kind: AccountKind; total: number; multi: boolean }) {
    const raw = drafts[account.id] ?? "";
    const value = currentValue(account.id);
    const previous = previousByAccount.get(account.id) ?? null;
    const info = value !== null ? deltaInfo(value, previous, account.kind) : null;
    const archived = isArchived(account.id);
    return (
      <div
        key={account.id}
        className="grid grid-cols-2 items-center gap-x-5 gap-y-1 px-4 py-1 md:col-span-full md:grid-cols-subgrid md:px-0 md:gap-y-0"
      >
        <div className="flex min-w-0 items-center gap-2 md:col-start-1 md:row-start-1">
          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: GROUP_COLORS[account.kind] }} />
          <span className="truncate text-sm font-semibold">{account.name}</span>
          {archived && (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">archived</span>
          )}
        </div>

        <div className="md:col-start-3 md:row-start-1">
          <Input
            id={`balance-${account.id}`}
            value={raw}
            aria-label={`${account.name} balance`}
            inputMode="decimal"
            disabled={isSkipped}
            onFocus={() => {
              focusedRef.current = account.id;
            }}
            onChange={(event) => onInputChange(account.id, event.target.value)}
            onBlur={() => onBlur(account.id)}
            onKeyDown={(event) => onInputKeyDown(event, account.id)}
            placeholder={previous !== null ? formatBalance(previous) : "0.00"}
            className="text-center tabular-nums"
          />
        </div>

        <div className="md:col-start-2 md:row-start-1">{renderProgress(account, group)}</div>

        <div className="flex items-center justify-end gap-2 md:col-start-4 md:row-start-1">
          {info && <ChangeChip info={info} showPercent />}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon" aria-label={`Actions for ${account.name}`} className="max-md:size-11" />}
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => openEdit(account)}>Edit account</DropdownMenuItem>
              <DropdownMenuSeparator />
              {archived ? (
                <>
                  <DropdownMenuItem onClick={() => run(unarchiveAccount(account.id, month))}>Unarchive</DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(account)}>
                    Delete
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem onClick={() => run(archiveAccount(account.id, month))}>Archive</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 items-center gap-3 lg:grid-cols-[1fr_auto_1fr]">
        <h1 className="text-2xl font-semibold">Accounts</h1>
        <div className="flex justify-center">
          <MonthNav value={month} months={months} onSelect={(next) => startTransition(() => router.push(`/accounts?month=${next}`))} />
        </div>
        <div className="flex items-center justify-end">
          {hasBalances && prevMonth && (
            <span className="text-sm text-muted-foreground">Changes vs {monthName(prevMonth)}</span>
          )}
        </div>
      </div>

      {error && status !== "error" && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {summaries.map((summary) => (
          <div key={summary.key} className="rounded-xl border bg-card px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              <span className="size-2 rounded-full" style={{ backgroundColor: summary.dot }} />
              {summary.label}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{moneyWhole(summary.value)}</div>
            <div className="mt-1.5">
              {prevMonth ? (
                <ChangeChip info={deltaInfo(summary.value, summary.previous, summary.kind)!} suffix={`vs ${monthName(prevMonth)}`} />
              ) : (
                <span className="text-xs text-muted-foreground">no prior data</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="relative rounded-xl border bg-card">
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4">
          <div>
            <h2 className="text-sm font-semibold">Balances for {monthLabel(month)}</h2>
            <p className="text-xs text-muted-foreground">Type a balance, then Tab to the next account.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!isSkipped &&
              (status === "saving" ? (
                <span className="text-xs text-muted-foreground">Saving…</span>
              ) : status === "error" ? (
                <button type="button" className="text-xs text-red-600 underline-offset-2 hover:underline" onClick={() => retryRef.current?.()}>
                  Couldn&apos;t save. Retry
                </button>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Check className="size-3.5 text-[#10b981]" /> All changes saved
                </span>
              ))}
            {prevMonth && (
              <Button variant="outline" size="sm" onClick={carryForward} disabled={isSkipped}>
                Carry forward from {monthName(prevMonth)}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="Balances options" className="max-md:size-11" />}>
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isSkipped ? (
                  <DropdownMenuItem onClick={() => run(unskipMonth(month))}>Unskip this month</DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => run(skipMonth(month))}>Skip this month</DropdownMenuItem>
                )}
                <DropdownMenuItem disabled={!hasBalances} onClick={() => setConfirmClear(true)}>
                  Clear balances for this month
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setShowArchived((value) => !value)}>
                  {showArchived ? "Hide archived" : "Show archived"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {!hasBalances && !isSkipped && prevMonth && accounts.length > 0 && (
          <p className="px-4 pt-2 text-xs text-muted-foreground">
            No balances yet for {monthLabel(month)}. Enter them below or carry forward from {monthName(prevMonth)}.
          </p>
        )}

        {accounts.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <p className="text-sm text-muted-foreground">No accounts yet. Add your first one to start tracking balances.</p>
            <Button onClick={openCreate}>
              <Plus className="size-4" /> Add account
            </Button>
          </div>
        ) : (
          <div className={cn("mt-1", isSkipped && "pointer-events-none opacity-40")}>
            {groups.map((group) => (
              <div key={group.kind} className="border-t border-border/60 first:border-t-0 md:grid md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_10rem_13rem] md:gap-x-5 md:px-4">
                <div className="flex items-center gap-5 px-4 py-1.5 md:col-span-full md:grid md:grid-cols-subgrid md:px-0 md:gap-y-0">
                  <div className="flex items-center gap-3 md:col-start-1">
                    <span
                      className="rounded-full px-2.5 py-0.5 text-xs font-bold tracking-wide uppercase"
                      style={{ backgroundColor: `${GROUP_COLORS[group.kind]}22`, color: GROUP_COLORS[group.kind] }}
                    >
                      {GROUP_LABELS[group.kind]}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {group.list.length} {group.list.length === 1 ? "account" : "accounts"}
                    </span>
                  </div>
                  <div className="ml-auto flex items-center gap-3 md:col-start-2 md:ml-0 md:justify-start">
                    <span className="text-sm font-semibold tabular-nums">{moneyWhole(group.total)}</span>
                    {prevMonth && <ChangeChip info={deltaInfo(group.total, group.previousTotal, group.kind)!} />}
                  </div>
                </div>
                {group.list.map((account) => renderRow(account, group))}
              </div>
            ))}

            <div className="border-t border-border/60 px-4 py-3">
              <button
                type="button"
                onClick={openCreate}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border py-3 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                <Plus className="size-4" /> Add account
              </button>
            </div>
          </div>
        )}

        {isSkipped && (
          <div className="absolute inset-0 grid place-items-center">
            <div className="flex flex-col items-center gap-3 rounded-xl border bg-background/80 px-8 py-10 text-center shadow-sm backdrop-blur-sm">
              <p className="text-2xl font-semibold text-muted-foreground">No data this month</p>
              <Button variant="outline" onClick={() => run(unskipMonth(month))}>Undo skip</Button>
            </div>
          </div>
        )}
      </div>

      <AccountDialog account={dialogAccount} open={dialogOpen} onOpenChange={setDialogOpen} />

      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Delete ${confirmDelete?.name ?? "account"}?`}
        description="All of this account's balance history will be deleted. This cannot be undone."
        confirmLabel="Delete account"
        onOpenChange={(open) => !open && setConfirmDelete(null)}
        onConfirm={() => confirmDelete && run(deleteAccount(confirmDelete.id))}
      />

      <ConfirmDialog
        open={confirmClear}
        title={`Clear balances for ${monthLabel(month)}?`}
        description="All account balances saved for this month will be removed. Account history for other months is not affected."
        confirmLabel="Clear balances"
        onOpenChange={setConfirmClear}
        onConfirm={() => run(clearBalances(month))}
      />
    </>
  );
}
