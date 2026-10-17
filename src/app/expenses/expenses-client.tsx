"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, MoreHorizontal, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { money, moneyWhole, parseAmountExpression } from "@/lib/money";
import { monthLabel } from "@/lib/month";
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
};

type CardItem = { id: string; name: string; color: string };

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

export function ExpensesClient({
  householdId,
  month,
  categories,
  cards,
  entries,
  idealByCategory,
  months,
}: {
  householdId: string;
  month: string;
  categories: Category[];
  cards: CardItem[];
  entries: Entry[];
  idealByCategory: Record<string, number>;
  months: string[];
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
        {cards.map((card) => (
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

  return (
    <>
      <div className="relative mb-3 grid grid-cols-1 items-center gap-3 lg:grid-cols-[1fr_auto_1fr]">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold">Expenses</h1>
          <p className="text-sm text-muted-foreground">Track and manage your household expenses, one category at a time.</p>
          {isPending && <span className="text-sm text-muted-foreground">updating…</span>}
        </div>
        <div className="flex justify-center">
          <MonthNav value={month} months={months} onSelect={goToMonth} />
        </div>
        <div className="flex items-center justify-end gap-2">
          {viewMode === "category" && (
            <select
              aria-label="Card filter"
              value={cardFilter}
              onChange={(event) => setCardFilter(event.target.value)}
              className="h-8 rounded-md border bg-background px-2 text-sm"
            >
              <option value="all">All cards</option>
              <option value="none">No card</option>
              {cards.map((card) => (
                <option key={card.id} value={card.id}>{card.name}</option>
              ))}
            </select>
          )}
          <Button onClick={() => run(fillRecurring(month))}>Add recurring items</Button>
          <Button variant="outline" onClick={() => setViewMode(viewMode === "category" ? "card" : "category")}>
            {viewMode === "category" ? "By card" : "By category"}
          </Button>
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {entries.length === 0 && (
        <div className="mb-3 rounded-md border border-primary/30 bg-primary/10 p-2 text-sm text-primary">
          No entries recorded for {monthLabel(month)} yet. Reminder: enter expenses around the 5th of every month.
        </div>
      )}

      <div className="sticky top-0 z-10 mb-3 grid gap-2 rounded-lg border bg-background/95 p-2 backdrop-blur md:grid-cols-4">
        <div className="rounded-md bg-muted px-2.5 py-1.5">
          <div className="text-xs text-muted-foreground">Income</div>
          <div className="text-base font-semibold tabular-nums text-green-600">{money(incomeTotal)}</div>
        </div>
        <div className="rounded-md bg-muted px-2.5 py-1.5">
          <div className="text-xs text-muted-foreground">Expenses</div>
          <div className="text-base font-semibold tabular-nums">{money(expenseTotal)}</div>
        </div>
        <div className="rounded-md bg-muted px-2.5 py-1.5">
          <div className="text-xs text-muted-foreground">Net</div>
          <div className={`text-base font-semibold tabular-nums ${netTotal >= 0 ? "text-green-600" : "text-red-600"}`}>
            {money(netTotal)}
          </div>
        </div>
        <div className="rounded-md bg-muted px-2.5 py-1.5">
          <div className="text-xs text-muted-foreground">Entries</div>
          <div className="text-base font-semibold tabular-nums">{expenseEntries.length}</div>
        </div>
      </div>

      {viewMode === "category" ? (
        <div className="space-y-2">
          {expenseCategories.map((category) => {
            const categoryEntries = (entriesByCategory.get(category.id) ?? []).filter((entry) =>
              cardFilter === "all" ? true : (entry.card_id ?? "none") === cardFilter
            );
            const categoryTotal = categoryEntries.reduce((sum, entry) => sum + entry.amount, 0);
            const ideal = idealByCategory[category.id] ?? 0;
            const idealRounded = Math.round(ideal);
            const difference = categoryTotal - idealRounded;
            const isOpen = expanded.has(category.id);
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
              <div key={category.id} className="rounded-xl bg-card ring-1 ring-foreground/10">
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-3 py-2 text-left"
                  onClick={toggle}
                >
                  <span className="size-3.5 shrink-0 rounded-full" style={{ backgroundColor: category.color }} />
                  <span className="font-heading text-sm font-semibold">{category.name}</span>
                  <span className="ml-auto flex items-center gap-3">
                    {ideal > 0 && (
                      <>
                        <span className="text-xs text-muted-foreground">ideal {moneyWhole(idealRounded)}</span>
                        <span className={`text-xs ${difference > 0 ? "text-red-600" : "text-green-600"}`}>
                          ({difference > 0 ? "+" : ""}{moneyWhole(difference)})
                        </span>
                      </>
                    )}
                    <span className="font-heading text-sm font-semibold tabular-nums">{money(categoryTotal)}</span>
                    {isOpen ? (
                      <ChevronUp className="size-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="size-4 text-muted-foreground" />
                    )}
                  </span>
                </button>

                {isOpen && (
                  <div className="pb-2.5">
                    {categoryEntries.map((entry) => renderEntryRow(entry, cardName(entry.card_id), null, cards))}

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
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {[...cards, { id: "none", name: "No card", color: "#6b7280" }].map((card) => {
            const cardEntries = expenseEntries.filter((entry) => (entry.card_id ?? "none") === card.id);
            const subtotal = cardTotals.get(card.id) ?? 0;
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
              <div key={card.id} className="rounded-xl bg-card ring-1 ring-foreground/10">
                <div className="flex items-center gap-3 px-3 py-2">
                  <span className="size-3.5 shrink-0 rounded-full" style={{ backgroundColor: card.color }} />
                  <span className="font-heading text-sm font-semibold">{card.name}</span>
                  <span className="ml-auto font-heading text-sm font-semibold tabular-nums">{money(subtotal)}</span>
                </div>
                <div className="pb-2.5">
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
          })}
        </div>
      )}

      <section className="mt-4">
        <div className="rounded-xl bg-card ring-1 ring-foreground/10">
          <div className="flex items-center gap-3 px-3 py-2">
            <h2 className="font-heading text-sm font-semibold">Income</h2>
            <span className="ml-auto font-heading text-sm font-semibold tabular-nums text-green-600">{money(incomeTotal)}</span>
          </div>
          <div className="pb-2.5">
            {incomeEntries.map((entry) => renderEntryRow(entry, categoryName(entry.category_id), incomeCategories, null))}
            <div className="flex items-center gap-2 px-3 pt-1.5">
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
              <p className="px-3 pt-1 text-xs text-muted-foreground">
                No income categories yet. Add one on the Categories page.
              </p>
            )}
          </div>
        </div>
      </section>

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
