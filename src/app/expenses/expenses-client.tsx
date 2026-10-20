"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, MoreHorizontal, Plus, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { money, moneyWhole, parseAmountExpression } from "@/lib/money";
import { monthLabel, monthName } from "@/lib/month";
import { deltaInfo, type DeltaInfo } from "@/lib/accounts";
import { MonthNav } from "@/components/month-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { addEntries, deleteEntry, fillRecurring, updateEntry, type ActionResult } from "./actions";

type Category = {
  id: string;
  name: string;
  color: string;
  kind: "expense" | "income";
  ideal_override: number | null;
  archived: boolean;
  group_id: string | null;
  no_ideal: boolean;
};

type Group = { id: string; name: string; color: string; sort_order: number };

type PreviousTotals = { income: number; expense: number; net: number; entries: number };

type CardItem = { id: string; name: string; color: string; archived: boolean };

type Entry = {
  id: string;
  category_id: string;
  card_id: string | null;
  amount: number;
  note: string | null;
  recurring_item_id: string | null;
};

type QuickDraft = { amount: string; cardId: string; categoryId?: string };

type EditTarget = {
  entry: Entry;
  categoryOptions: Category[] | null;
  cardOptions: CardItem[] | null;
};

const TONE_CLASSES: Record<"positive" | "negative" | "neutral", string> = {
  positive: "bg-[#10b981]/15 text-[#0f7a52] dark:bg-[#10b981]/20 dark:text-[#5ee0b0]",
  negative: "bg-[#ef4444]/12 text-[#b3261e] dark:bg-[#ef4444]/20 dark:text-[#fca5a5]",
  neutral: "bg-muted text-muted-foreground",
};

function SummaryChip({ info, suffix }: { info: DeltaInfo; suffix?: string }) {
  const tone = info.good === null ? "neutral" : info.good ? "positive" : "negative";
  const Icon = info.direction === "up" ? ArrowUp : info.direction === "down" ? ArrowDown : null;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap tabular-nums ${TONE_CLASSES[tone]}`}>
      {Icon && <Icon className="size-3" />}
      {info.delta >= 0 ? "+" : ""}
      {moneyWhole(info.delta)}
      {suffix ? <span className="font-normal opacity-70">{suffix}</span> : null}
    </span>
  );
}

export function ExpensesClient({
  householdId,
  month,
  categories,
  cards,
  entries,
  idealByCategory,
  months,
  groups,
  previousTotals,
  prevMonth,
}: {
  householdId: string;
  month: string;
  categories: Category[];
  cards: CardItem[];
  entries: Entry[];
  idealByCategory: Record<string, number>;
  months: string[];
  groups: Group[];
  previousTotals: PreviousTotals;
  prevMonth: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [viewMode, setViewMode] = useState<"category" | "card">("category");
  const [cardFilter, setCardFilter] = useState("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [quick, setQuick] = useState<Record<string, QuickDraft>>({});
  const [newIncome, setNewIncome] = useState({ categoryId: "", amount: "" });
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`ledger:${householdId}:${month}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ledger_entries", filter: `household_id=eq.${householdId}` },
        () => startTransition(() => router.refresh())
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [householdId, month, router]);

  const activeCategories = useMemo(() => categories.filter((category) => !category.archived), [categories]);
  const activeCards = useMemo(() => cards.filter((card) => !card.archived), [cards]);
  const expenseCategories = useMemo(() => activeCategories.filter((category) => category.kind === "expense"), [activeCategories]);
  const incomeCategories = useMemo(() => activeCategories.filter((category) => category.kind === "income"), [activeCategories]);

  const kindById = useMemo(() => new Map(categories.map((category) => [category.id, category.kind])), [categories]);
  const cardById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);

  const expenseEntries = useMemo(
    () => entries.filter((entry) => kindById.get(entry.category_id) === "expense"),
    [entries, kindById]
  );
  const incomeEntries = useMemo(
    () => entries.filter((entry) => kindById.get(entry.category_id) === "income"),
    [entries, kindById]
  );

  const entriesByCategory = useMemo(() => {
    const map = new Map<string, Entry[]>();
    expenseCategories.forEach((category) => map.set(category.id, []));
    expenseEntries.forEach((entry) => {
      const list = map.get(entry.category_id);
      if (list) list.push(entry);
    });
    return map;
  }, [expenseEntries, expenseCategories]);

  const expenseTotal = useMemo(() => expenseEntries.reduce((sum, entry) => sum + entry.amount, 0), [expenseEntries]);
  const incomeTotal = useMemo(() => incomeEntries.reduce((sum, entry) => sum + entry.amount, 0), [incomeEntries]);
  const netTotal = incomeTotal - expenseTotal;

  const groupsWithCategories = useMemo(() => {
    const known = new Set(groups.map((group) => group.id));
    const list = groups.map((group) => ({
      group,
      categories: expenseCategories.filter((category) => category.group_id === group.id),
    }));
    const ungrouped = expenseCategories.filter((category) => !category.group_id || !known.has(category.group_id));
    if (ungrouped.length > 0) {
      list.push({ group: { id: "", name: "Ungrouped", color: "#6b7280", sort_order: 9999 }, categories: ungrouped });
    }
    return list.filter((entry) => entry.categories.length > 0);
  }, [groups, expenseCategories]);

  const visibleGroups = useMemo(() => {
    if (!query) return groupsWithCategories;
    return groupsWithCategories
      .map(({ group, categories }) => ({
        group,
        categories: categories.filter((category) => category.name.toLowerCase().includes(query)),
      }))
      .filter((entry) => entry.categories.length > 0);
  }, [groupsWithCategories, query]);

  const visibleCards = useMemo(() => {
    const list = [...cards, { id: "none", name: "No card", color: "#6b7280" }];
    if (!query) return list;
    return list.filter((card) =>
      expenseEntries.some(
        (entry) =>
          (entry.card_id ?? "none") === card.id &&
          (categoryById.get(entry.category_id)?.name ?? "").toLowerCase().includes(query)
      )
    );
  }, [cards, expenseEntries, query, categoryById]);

  const filteredEntries = useCallback(
    (categoryId: string) =>
      (entriesByCategory.get(categoryId) ?? []).filter((entry) =>
        cardFilter === "all" ? true : (entry.card_id ?? "none") === cardFilter
      ),
    [entriesByCategory, cardFilter]
  );

  const categoryTotal = useCallback(
    (categoryId: string) => filteredEntries(categoryId).reduce((sum, entry) => sum + entry.amount, 0),
    [filteredEntries]
  );

  const cardTotals = useMemo(() => {
    const map = new Map<string, number>();
    map.set("none", 0);
    cards.forEach((card) => map.set(card.id, 0));
    expenseEntries.forEach((entry) => {
      const key = entry.card_id ?? "none";
      map.set(key, (map.get(key) ?? 0) + entry.amount);
    });
    return map;
  }, [expenseEntries, cards]);

  const summaries = [
    { key: "income", label: "Income", value: incomeTotal, previous: previousTotals.income, dot: "#10b981", kind: "liquid" as const, currency: true },
    { key: "expense", label: "Expenses", value: expenseTotal, previous: previousTotals.expense, dot: "#ef4444", kind: "loan" as const, currency: true },
    { key: "net", label: "Net", value: netTotal, previous: previousTotals.net, dot: netTotal >= 0 ? "#10b981" : "#ef4444", kind: "liquid" as const, currency: true },
    { key: "entries", label: "Entries", value: expenseEntries.length, previous: previousTotals.entries, dot: "#6b7280", kind: "liquid" as const, currency: false },
  ];

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
    startTransition(() => router.push(`/expenses?month=${nextMonth}`));
  }

  function setQuickDraft(key: string, patch: Partial<QuickDraft>) {
    setQuick((state) => ({ ...state, [key]: { ...(state[key] ?? { amount: "", cardId: "none" }), ...patch } }));
  }

  function cardName(id: string | null) {
    return (id && cardById.get(id)?.name) || "—";
  }

  function categoryName(id: string) {
    return categoryById.get(id)?.name ?? "—";
  }

  function renderCardSelector(value: string, onChange: (value: string) => void, key: string, className?: string) {
    return (
      <select
        key={key}
        defaultValue={value}
        onChange={(event) => onChange(event.target.value)}
        className={className ?? "h-8 rounded-md border bg-background px-2 text-sm"}
      >
        <option value="none">No card</option>
        {activeCards.map((card) => (
          <option key={card.id} value={card.id}>
            {card.name}
          </option>
        ))}
      </select>
    );
  }

  function renderEntryRow(
    entry: Entry,
    label: string,
    categoryOptions: Category[] | null,
    cardOptions: CardItem[] | null
  ) {
    return (
      <div
        key={entry.id}
        className="group/row flex items-center gap-3 px-3 py-[3px] text-xs text-muted-foreground"
      >
        <span className="w-20 shrink-0 tabular-nums">{money(entry.amount)}</span>
        <span className="truncate">{label}</span>
        <div className="ml-auto flex items-center">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Entry options"
                  className="text-muted-foreground opacity-50 group-hover/row:opacity-100"
                />
              }
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-28">
              <DropdownMenuItem onClick={() => setEditing({ entry, categoryOptions, cardOptions })}>
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => run(deleteEntry(entry.id))}>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  }

  function submitIncome() {
    const amount = Number(newIncome.amount);
    const categoryId = newIncome.categoryId || incomeCategories[0]?.id;
    if (!categoryId || !Number.isFinite(amount)) return;
    run(addEntries({ month, categoryId, cardId: null, note: null, amounts: [amount] })).then((ok) => {
      if (ok) setNewIncome({ categoryId: newIncome.categoryId, amount: "" });
    });
  }

  function renderCategoryBox(category: Category, group: Group) {
    const list = filteredEntries(category.id);
    const total = list.reduce((sum, entry) => sum + entry.amount, 0);
    const ideal = idealByCategory[category.id] ?? 0;
    const idealRounded = Math.round(ideal);
    const difference = total - idealRounded;
    const showIdeal = !category.no_ideal && ideal > 0;
    const isOpen = query !== "" || expanded.has(category.id);
    const quickKey = category.id;
    const quickState = quick[quickKey] ?? { amount: "", cardId: cardFilter === "all" ? "none" : cardFilter };

    function toggle() {
      setExpanded((existing) => {
        const next = new Set(existing);
        if (next.has(category.id)) next.delete(category.id);
        else next.add(category.id);
        return next;
      });
    }

    function submitQuick(split: boolean) {
      const parts = parseAmountExpression(quickState.amount);
      if (!parts) return;
      const amounts = split && parts.length > 1 ? parts : [parts.reduce((sum, part) => sum + part, 0)];
      run(
        addEntries({
          month,
          categoryId: category.id,
          cardId: quickState.cardId === "none" ? null : quickState.cardId,
          note: null,
          amounts,
        })
      ).then((ok) => {
        if (ok) setQuickDraft(quickKey, { amount: "" });
      });
    }

    return (
      <div key={category.id}>
        <button
          type="button"
          className="flex w-full items-center gap-3 border-b border-border/60 px-3 py-2 text-left"
          onClick={toggle}
        >
          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: group.color }} />
          <span className="font-heading text-sm font-semibold">{category.name}</span>
          <span className="ml-auto flex items-center gap-3">
            <span className="flex items-center gap-4">
              {showIdeal && (
                <span className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">ideal {moneyWhole(idealRounded)}</span>
                  <span className={difference > 0 ? "text-red-600" : "text-green-600"}>
                    ({difference > 0 ? "+" : ""}{moneyWhole(difference)})
                  </span>
                </span>
              )}
              <span className="font-heading text-sm font-semibold tabular-nums">{money(total)}</span>
            </span>
            {isOpen ? (
              <ChevronUp className="size-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="size-4 text-muted-foreground" />
            )}
          </span>
        </button>

        {isOpen && (
          <div className="pb-2.5">
            {list.map((entry) => renderEntryRow(entry, cardName(entry.card_id), null, cards))}

            <div className="flex items-center gap-2 px-3 pt-1.5">
              <Input
                placeholder="Amount (e.g. 12.50+8)"
                title="Enter adds the total; Shift+Enter splits each part into its own entry."
                value={quickState.amount}
                onChange={(event) => setQuickDraft(quickKey, { amount: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  submitQuick(event.shiftKey);
                }}
                inputMode="decimal"
                className="h-8 flex-1 text-sm tabular-nums"
              />
              {renderCardSelector(
                quickState.cardId,
                (value) => setQuickDraft(quickKey, { cardId: value }),
                `quick-${quickKey}`,
                "h-8 w-40 shrink-0 rounded-md border bg-background px-2 text-sm"
              )}
              <Button size="icon" className="size-8 shrink-0" aria-label="Add entry" onClick={() => submitQuick(false)}>
                <Plus className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="relative mb-4 grid grid-cols-1 items-center gap-3 lg:grid-cols-[1fr_auto_1fr]">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold">Expenses</h1>
          {isPending && <span className="text-sm text-muted-foreground">updating…</span>}
        </div>
        <div className="flex justify-center">
          <MonthNav value={month} months={months} onSelect={goToMonth} />
        </div>
        <div />
      </div>

      {error && <p className="my-3 text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {summaries.map((summary) => (
          <div key={summary.key} className="rounded-xl border bg-card px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              <span className="size-2 rounded-full" style={{ backgroundColor: summary.dot }} />
              {summary.label}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {summary.currency ? moneyWhole(summary.value) : summary.value}
            </div>
            <div className="mt-1.5">
              {!prevMonth ? (
                <span className="text-xs text-muted-foreground">no prior data</span>
              ) : summary.currency ? (
                <SummaryChip info={deltaInfo(summary.value, summary.previous, summary.kind)!} suffix={`vs ${monthName(prevMonth)}`} />
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">
                  {summary.value - summary.previous >= 0 ? "+" : ""}
                  {summary.value - summary.previous}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="my-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search categories"
            placeholder="Search categories…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-8 w-full pl-8 text-sm sm:w-48"
          />
        </div>
        {viewMode === "category" && (
          <select
            aria-label="Card filter"
            value={cardFilter}
            onChange={(event) => setCardFilter(event.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-sm"
          >
            <option value="all">All cards</option>
            <option value="none">No card</option>
            {activeCards.map((card) => (
              <option key={card.id} value={card.id}>{card.name}</option>
            ))}
          </select>
        )}
        <Button onClick={() => run(fillRecurring(month))}>Add recurring items</Button>
        <Button variant="outline" onClick={() => setViewMode(viewMode === "category" ? "card" : "category")}>
          {viewMode === "category" ? "By card" : "By category"}
        </Button>
      </div>

      <div className="rounded-xl border bg-card">
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4">
          <div>
            <h2 className="text-sm font-semibold">Expenses for {monthLabel(month)}</h2>
            <p className="text-xs text-muted-foreground">Type an amount, then Shift+Enter to continue to another amount.</p>
          </div>
        </div>

        <div className="p-3">
          {viewMode === "category" ? (
            <div className="space-y-3">
              {groupsWithCategories.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">No expense categories yet. Add one on the Categories page.</p>
              ) : visibleGroups.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">No categories match “{search.trim()}”.</p>
              ) : (
                visibleGroups.map(({ group, categories: groupCategories }) => {
                  const groupSpent = groupCategories.reduce((sum, category) => sum + categoryTotal(category.id), 0);
                  return (
                    <div key={group.id || "ungrouped"} className="space-y-1">
                      <div
                        className="group-tint -mx-3 flex items-center gap-2 rounded-lg px-5 py-1.5"
                        style={{ "--group-color": group.color } as React.CSSProperties}
                      >
                        <span className="size-3.5 shrink-0 rounded-full" style={{ backgroundColor: group.color }} />
                        <span className="font-heading text-base font-bold">{group.name}</span>
                        <span className="ml-auto text-xs tabular-nums text-muted-foreground">{money(groupSpent)}</span>
                      </div>
                      {groupCategories.map((category) => renderCategoryBox(category, group))}
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {visibleCards.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">No matches for “{search.trim()}”.</p>
              ) : (
                visibleCards.map((card) => {
                const cardEntries = expenseEntries.filter(
                  (entry) =>
                    (entry.card_id ?? "none") === card.id &&
                    (!query || (categoryById.get(entry.category_id)?.name ?? "").toLowerCase().includes(query))
                );
                const subtotal = query ? cardEntries.reduce((sum, entry) => sum + entry.amount, 0) : cardTotals.get(card.id) ?? 0;
                const quickKey = `card:${card.id}`;
                const quickState = quick[quickKey] ?? { amount: "", cardId: card.id, categoryId: expenseCategories[0]?.id ?? "" };

                function submitQuick(split: boolean) {
                  const parts = parseAmountExpression(quickState.amount);
                  const categoryId = quickState.categoryId ?? expenseCategories[0]?.id;
                  if (!parts || !categoryId) return;
                  const amounts = split && parts.length > 1 ? parts : [parts.reduce((sum, part) => sum + part, 0)];
                  run(
                    addEntries({
                      month,
                      categoryId,
                      cardId: card.id === "none" ? null : card.id,
                      note: null,
                      amounts,
                    })
                  ).then((ok) => {
                    if (ok) setQuickDraft(quickKey, { amount: "" });
                  });
                }

                return (
                  <div key={card.id} className="space-y-0.5">
                    <div className="flex items-center gap-3 border-b border-border/60 px-3 py-2">
                      <span className="size-3.5 shrink-0 rounded-full" style={{ backgroundColor: card.color }} />
                      <span className="font-heading text-sm font-semibold">{card.name}</span>
                      <span className="ml-auto font-heading text-sm font-semibold tabular-nums">{money(subtotal)}</span>
                    </div>
                    <div>
                      {cardEntries.map((entry) =>
                        renderEntryRow(entry, categoryName(entry.category_id), expenseCategories, cards)
                      )}
                      <div className="flex items-center gap-2 px-3 pt-1.5">
                        <Input
                          placeholder="Amount (e.g. 12.50+8)"
                          title="Enter adds the total; Shift+Enter splits each part into its own entry."
                          value={quickState.amount}
                          onChange={(event) => setQuickDraft(quickKey, { amount: event.target.value })}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter") return;
                            event.preventDefault();
                            submitQuick(event.shiftKey);
                          }}
                          inputMode="decimal"
                          className="h-8 flex-1 text-sm tabular-nums"
                        />
                        <select
                          value={quickState.categoryId ?? expenseCategories[0]?.id ?? ""}
                          onChange={(event) => setQuickDraft(quickKey, { categoryId: event.target.value })}
                          className="h-8 w-48 shrink-0 rounded-md border bg-background px-2 text-sm"
                        >
                          {expenseCategories.map((category) => (
                            <option key={category.id} value={category.id}>{category.name}</option>
                          ))}
                        </select>
                        <Button size="icon" className="size-8 shrink-0" aria-label="Add entry" onClick={() => submitQuick(false)}>
                          <Plus className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
                })
              )}
            </div>
          )}

          <section className="mt-4 border-t border-border/60 pt-3">
            <div className="flex items-center gap-3 px-1">
              <h2 className="font-heading text-sm font-semibold">Income</h2>
              <span className="ml-auto font-heading text-sm font-semibold tabular-nums text-green-600">{money(incomeTotal)}</span>
            </div>
            <div className="mt-1.5">
              {incomeEntries.map((entry) => renderEntryRow(entry, categoryName(entry.category_id), incomeCategories, null))}
              <div className="flex items-center gap-2 px-1 pt-1.5">
                <Input
                  placeholder="Amount"
                  value={newIncome.amount}
                  onChange={(event) => setNewIncome((state) => ({ ...state, amount: event.target.value }))}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    submitIncome();
                  }}
                  inputMode="decimal"
                  className="h-8 flex-1 text-sm tabular-nums"
                />
                <select
                  value={newIncome.categoryId || incomeCategories[0]?.id || ""}
                  onChange={(event) => setNewIncome((state) => ({ ...state, categoryId: event.target.value }))}
                  className="h-8 w-48 shrink-0 rounded-md border bg-background px-2 text-sm"
                  disabled={incomeCategories.length === 0}
                >
                  {incomeCategories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
                <Button
                  size="icon"
                  className="size-8 shrink-0"
                  aria-label="Add income"
                  disabled={incomeCategories.length === 0}
                  onClick={submitIncome}
                >
                  <Plus className="size-4" />
                </Button>
              </div>
              {incomeCategories.length === 0 && (
                <p className="px-1 pt-1 text-xs text-muted-foreground">
                  No income categories yet. Add one on the Categories page.
                </p>
              )}
            </div>
          </section>
        </div>
      </div>

      {editing && (
        <EntryDialog
          key={editing.entry.id}
          entry={editing.entry}
          categoryOptions={editing.categoryOptions}
          cardOptions={editing.cardOptions}
          onClose={() => setEditing(null)}
          onSave={(patch) => run(updateEntry({ id: editing.entry.id, ...patch }))}
        />
      )}
    </>
  );
}

function EntryDialog({
  entry,
  categoryOptions,
  cardOptions,
  onClose,
  onSave,
}: {
  entry: Entry;
  categoryOptions: Category[] | null;
  cardOptions: CardItem[] | null;
  onClose: () => void;
  onSave: (patch: { amount: number; note: string; cardId?: string | null; categoryId?: string }) => Promise<boolean>;
}) {
  const [amount, setAmount] = useState(String(entry.amount));
  const [categoryId, setCategoryId] = useState(entry.category_id);
  const [cardId, setCardId] = useState(entry.card_id ?? "none");
  const [note, setNote] = useState(entry.note ?? "");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value)) return;
    setBusy(true);
    const ok = await onSave({
      amount: value,
      note,
      ...(categoryOptions ? { categoryId } : {}),
      ...(cardOptions ? { cardId: cardId === "none" ? null : cardId } : {}),
    });
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit entry</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          {categoryOptions && (
            <div className="space-y-1">
              <Label htmlFor="entry-category">Category</Label>
              <select
                id="entry-category"
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                {categoryOptions.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="entry-amount">Amount</Label>
            <Input
              id="entry-amount"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              className="tabular-nums"
              autoFocus
            />
          </div>
          {cardOptions && (
            <div className="space-y-1">
              <Label htmlFor="entry-card">Card</Label>
              <select
                id="entry-card"
                value={cardId}
                onChange={(event) => setCardId(event.target.value)}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                <option value="none">No card</option>
                {cardOptions.map((card) => (
                  <option key={card.id} value={card.id}>{card.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="entry-note">Note</Label>
            <Input
              id="entry-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="note"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
