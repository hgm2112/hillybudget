"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { money, parseAmountExpression } from "@/lib/money";
import { monthLabel, shiftMonth, toMonthKey } from "@/lib/month";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

type Category = {
  id: string;
  household_id: string;
  name: string;
  color: string;
  type: "expense" | "income";
  sort_order: number;
  archived: boolean;
  ideal_override: number | null;
};

type Card = {
  id: string;
  household_id: string;
  name: string;
  color: string;
  archived: boolean;
};

type Entry = {
  id: string;
  household_id: string;
  month: string;
  category_id: string;
  card_id: string | null;
  amount: number;
  note: string | null;
  recurring_item_id: string | null;
  is_imported: boolean;
};

type IncomeItem = {
  id: string;
  household_id: string;
  month: string;
  source: string;
  amount: number;
};

type MonthlyTotal = {
  household_id: string;
  category_id: string;
  month: string;
  total: number;
};

type QuickDraft = {
  amount: string;
  cardId: string;
  note: string;
  categoryId?: string;
};

export default function ExpensesPage() {
  const router = useRouter();
  const supabase = createClient();

  const [householdId, setHouseholdId] = useState<string | null>(null);
  
  const [categories, setCategories] = useState<Category[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [incomeItems, setIncomeItems] = useState<IncomeItem[]>([]);
  const [monthlyTotals, setMonthlyTotals] = useState<MonthlyTotal[]>([]);
  const [idealWindow, setIdealWindow] = useState("trailing12");
  const [month, setMonth] = useState(() => (typeof window === "undefined" ? "" : toMonthKey(new Date())));
  const [viewMode, setViewMode] = useState<"category" | "card">("category");
  const [cardFilter, setCardFilter] = useState("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [quick, setQuick] = useState<Record<string, QuickDraft>>({});
  const [incomeDrafts, setIncomeDrafts] = useState<Record<string, { source: string; amount: string }>>({});
  const [entryDrafts, setEntryDrafts] = useState<Record<string, { amount: string; cardId: string; note: string }>>({});
  const [loading, setLoading] = useState(true);

  const [newIncome, setNewIncome] = useState({ source: "Paycheck", amount: "" });

  const loadBase = useCallback(async (hid: string) => {
    const [categoryResult, cardResult, settingsResult, totalsResult] = await Promise.all([
      supabase.from("categories").select("*").eq("household_id", hid).order("sort_order"),
      supabase.from("cards").select("*").eq("household_id", hid).order("sort_order"),
      supabase.from("household_settings").select("*").eq("household_id", hid).maybeSingle(),
      supabase.from("monthly_category_totals").select("*").eq("household_id", hid),
    ]);
    setCategories((categoryResult.data ?? []) as Category[]);
    setCards((cardResult.data ?? []) as Card[]);
    setIdealWindow(settingsResult.data?.ideal_window ?? "trailing12");
    setMonthlyTotals((totalsResult.data ?? []).map((row) => ({ ...row, total: Number(row.total) })) as MonthlyTotal[]);
  }, [supabase]);

  const loadMonth = useCallback(async (hid: string, currentMonth: string) => {
    setLoading(true);
    const [entryResult, incomeResult] = await Promise.all([
      supabase.from("entries").select("*").eq("household_id", hid).eq("month", currentMonth),
      supabase.from("income").select("*").eq("household_id", hid).eq("month", currentMonth),
    ]);
    const nextEntries = ((entryResult.data ?? []) as Entry[]).map((entry) => ({
      ...entry,
      amount: Number(entry.amount),
    }));
    setEntries(nextEntries);
    const nextDrafts: Record<string, { amount: string; cardId: string; note: string }> = {};
    nextEntries.forEach((entry) => {
      nextDrafts[entry.id] = { amount: String(entry.amount), cardId: entry.card_id ?? "none", note: entry.note ?? "" };
    });
    setEntryDrafts(nextDrafts);
    setIncomeItems(((incomeResult.data ?? []) as IncomeItem[]).map((item) => ({ ...item, amount: Number(item.amount) })));
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    let active = true;
    async function init() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        router.replace("/login");
        return;
      }
      const { data: membership } = await supabase
        .from("household_members")
        .select("household_id")
        .eq("user_id", userData.user.id)
        .limit(1)
        .maybeSingle();
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
  }, [router, supabase, loadBase]);

  useEffect(() => {
    if (!householdId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadMonth(householdId, month);
  }, [householdId, month, loadMonth]);

  useEffect(() => {
    if (!householdId) return;
    const channel = supabase
      .channel(`expenses:${householdId}:${month}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "entries", filter: `household_id=eq.${householdId}` },
        () => loadMonth(householdId, month)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "income", filter: `household_id=eq.${householdId}` },
        () => loadMonth(householdId, month)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [householdId, month, loadMonth, supabase]);


  const activeCategories = useMemo(() => categories.filter((category) => !category.archived), [categories]);
  const visibleCategories = useMemo(() => activeCategories, [activeCategories]);

  const entriesByCategory = useMemo(() => {
    const map = new Map<string, Entry[]>();
    activeCategories.forEach((category) => map.set(category.id, []));
    entries.forEach((entry) => {
      const list = map.get(entry.category_id);
      if (list) list.push(entry);
    });
    return map;
  }, [entries, activeCategories]);

  const expenseTotal = useMemo(() => entries.reduce((sum, entry) => sum + Number(entry.amount), 0), [entries]);
  const incomeTotal = useMemo(() => incomeItems.reduce((sum, item) => sum + Number(item.amount), 0), [incomeItems]);
  const netTotal = incomeTotal - expenseTotal;

  const cardTotals = useMemo(() => {
    const map = new Map<string, number>();
    map.set("none", 0);
    cards.forEach((card) => map.set(card.id, 0));
    entries.forEach((entry) => {
      const key = entry.card_id ?? "none";
      map.set(key, (map.get(key) ?? 0) + Number(entry.amount));
    });
    return map;
  }, [entries, cards]);

  function cutoffDate() {
    if (idealWindow === "trailing6") return shiftMonth(month, -6);
    if (idealWindow === "trailing12") return shiftMonth(month, -12);
    return "1900-01-01";
  }

  function idealFor(category: Category) {
    if (category.ideal_override !== null) return Number(category.ideal_override);
    const cutoff = cutoffDate();
    const rows = monthlyTotals.filter((total) => total.category_id === category.id && total.month < month && total.month >= cutoff && total.total !== 0);
    if (rows.length === 0) return 0;
    return rows.reduce((sum, row) => sum + row.total, 0) / rows.length;
  }

  async function addEntry(categoryId: string, parts: number[], cardId: string, note: string, split: boolean) {
    if (!householdId) return;
    const realCardId = cardId === "none" ? null : cardId;
    if (split) {
      await supabase.from("entries").insert(
        parts.map((part) => ({
          household_id: householdId,
          month,
          category_id: categoryId,
          card_id: realCardId,
          amount: part,
          note: note || null,
        }))
      );
    } else {
      await supabase.from("entries").insert({
        household_id: householdId,
        month,
        category_id: categoryId,
        card_id: realCardId,
        amount: parts.reduce((sum, part) => sum + part, 0),
        note: note || null,
      });
    }
    setQuick((state) => ({
      ...state,
      [categoryId]: { amount: "", cardId, note: "" },
    }));
    await loadMonth(householdId, month);
    const totals = await supabase.from("monthly_category_totals").select("*").eq("household_id", householdId);
    setMonthlyTotals((totals.data ?? []).map((row) => ({ ...row, total: Number(row.total) })) as MonthlyTotal[]);
  }

  async function updateEntryDraft(entryId: string) {
    const draft = entryDrafts[entryId];
    if (!draft) return;
    const amount = Number(draft.amount);
    if (!Number.isFinite(amount)) return;
    await supabase
      .from("entries")
      .update({
        amount,
        card_id: draft.cardId === "none" ? null : draft.cardId,
        note: draft.note || null,
      })
      .eq("id", entryId);
    if (householdId) await loadMonth(householdId, month);
  }

  async function deleteEntry(entryId: string) {
    await supabase.from("entries").delete().eq("id", entryId);
    if (householdId) await loadMonth(householdId, month);
  }

  async function addIncomeItem() {
    if (!householdId) return;
    const amount = Number(newIncome.amount);
    if (!Number.isFinite(amount)) return;
    await supabase.from("income").insert({
      household_id: householdId,
      month,
      source: newIncome.source,
      amount,
    });
    setNewIncome({ source: "Paycheck", amount: "" });
    await loadMonth(householdId, month);
  }

  async function updateIncomeItem(id: string, source: string, amount: string) {
    const numeric = Number(amount);
    if (!Number.isFinite(numeric)) return;
    await supabase.from("income").update({ source, amount: numeric }).eq("id", id);
    if (householdId) await loadMonth(householdId, month);
  }

  async function deleteIncomeItem(id: string) {
    await supabase.from("income").delete().eq("id", id);
    if (householdId) await loadMonth(householdId, month);
  }

  async function fillRecurring() {
    if (!householdId) return;
    const { data: templates } = await supabase
      .from("recurring_items")
      .select("*")
      .eq("household_id", householdId)
      .eq("active", true);
    const activeTemplates = (templates ?? []).filter((template) => {
      if (template.start_month > month) return false;
      if (template.end_month && template.end_month < month) return false;
      return true;
    });
    if (activeTemplates.length === 0) return;
    const { data: existing } = await supabase
      .from("entries")
      .select("recurring_item_id")
      .eq("household_id", householdId)
      .eq("month", month);
    const existingIds = new Set((existing ?? []).map((entry) => entry.recurring_item_id).filter(Boolean));
    const toInsert = activeTemplates
      .filter((template) => !existingIds.has(template.id))
      .map((template) => ({
        household_id: householdId,
        month,
        category_id: template.category_id,
        card_id: template.card_id,
        amount: Number(template.amount),
        note: template.note,
        recurring_item_id: template.id,
      }));
    if (toInsert.length === 0) return;
    await supabase.from("entries").insert(toInsert);
    await loadMonth(householdId, month);
  }

  function setExpandedCategory(id: string, expandedState: boolean) {
    setExpanded((existing) => {
      const next = new Set(existing);
      if (expandedState) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function renderCardSelector(value: string, onChange: (value: string) => void, className?: string) {
    return (
      <select
        value={value}
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

  if (loading || !householdId || !month) {
    return <main className="p-8">Loading...</main>;
  }

  return (
    <main className="mx-auto max-w-7xl p-4 md:p-8">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Monthly expenses</h1>
          <p className="text-sm text-muted-foreground">{monthLabel(month)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setMonth(shiftMonth(month, -1))}>Previous</Button>
          <Button variant="outline" onClick={() => setMonth(toMonthKey(new Date()))}>This month</Button>
          <Button variant="outline" onClick={() => setMonth(shiftMonth(month, 1))}>Next</Button>
          <Button onClick={fillRecurring}>Fill recurring</Button>
          <Button variant="outline" onClick={() => setViewMode(viewMode === "category" ? "card" : "category")}>
            {viewMode === "category" ? "By card" : "By category"}
          </Button>
        </div>
      </div>

      {entries.length === 0 && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          No entries recorded for {monthLabel(month)} yet. Reminder: enter expenses around the 5th.
        </div>
      )}

      <div className="sticky top-0 z-10 mb-4 grid gap-2 rounded-lg border bg-background/95 p-3 backdrop-blur md:grid-cols-4">
        <div className="rounded-md bg-muted p-3">
          <div className="text-xs text-muted-foreground">Income</div>
          <div className="text-lg font-semibold tabular-nums text-green-600">{money(incomeTotal)}</div>
        </div>
        <div className="rounded-md bg-muted p-3">
          <div className="text-xs text-muted-foreground">Expenses</div>
          <div className="text-lg font-semibold tabular-nums">{money(expenseTotal)}</div>
        </div>
        <div className="rounded-md bg-muted p-3">
          <div className="text-xs text-muted-foreground">Net</div>
          <div className={`text-lg font-semibold tabular-nums ${netTotal >= 0 ? "text-green-600" : "text-red-600"}`}>
            {money(netTotal)}
          </div>
        </div>
        <div className="rounded-md bg-muted p-3">
          <div className="text-xs text-muted-foreground">Entries</div>
          <div className="text-lg font-semibold tabular-nums">{entries.length}</div>
        </div>
      </div>

      {viewMode === "category" && (
        <div className="mb-4 flex items-center gap-2">
          <label className="text-sm text-muted-foreground" htmlFor="card-filter">Card filter:</label>
          <select
            id="card-filter"
            value={cardFilter}
            onChange={(event) => setCardFilter(event.target.value)}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="all">All cards</option>
            <option value="none">No card</option>
            {cards.map((card) => (
              <option key={card.id} value={card.id}>{card.name}</option>
            ))}
          </select>
        </div>
      )}

      {viewMode === "category" ? (
        <div className="space-y-3">
          {visibleCategories.map((category) => {
            const categoryEntries = (entriesByCategory.get(category.id) ?? []).filter((entry) =>
              cardFilter === "all" ? true : (entry.card_id ?? "none") === cardFilter
            );
            const categoryTotal = categoryEntries.reduce((sum, entry) => sum + Number(entry.amount), 0);
            const ideal = idealFor(category);
            const difference = categoryTotal - ideal;
            const quickState = quick[category.id] ?? { amount: "", cardId: cardFilter === "all" ? "none" : cardFilter, note: "" };
            return (
              <Card key={category.id}>
                <CardContent className="p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <button
                      type="button"
                      className="flex items-center gap-3 text-left"
                      onClick={() => setExpandedCategory(category.id, !expanded.has(category.id))}
                    >
                      <span className="h-4 w-4 rounded-full" style={{ backgroundColor: category.color }} />
                      <span className="font-medium">{category.name}</span>
                      <Badge variant="secondary" className="tabular-nums">{money(categoryTotal)}</Badge>
                      {ideal > 0 && (
                        <span className={`text-xs ${difference > 0 ? "text-red-600" : "text-green-600"}`}>
                          ideal {money(ideal)} ({difference > 0 ? "+" : ""}{money(difference)})
                        </span>
                      )}
                      {category.type === "income" && <Badge>income</Badge>}
                    </button>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      {categoryEntries.length} entries
                    </div>
                  </div>

                  {expanded.has(category.id) && (
                    <div className="mt-4 space-y-3">
                      <div className="space-y-2">
                        {categoryEntries.map((entry) => (
                          <div key={entry.id} className="grid gap-2 md:grid-cols-[1fr_1fr_2fr_auto]">
                            <Input
                              value={entryDrafts[entry.id]?.amount ?? ""}
                              onChange={(e) =>
                                setEntryDrafts((state) => ({
                                  ...state,
                                  [entry.id]: { ...state[entry.id], amount: e.target.value },
                                }))
                              }
                              onBlur={() => updateEntryDraft(entry.id)}
                              inputMode="decimal"
                              className="tabular-nums"
                            />
                            {renderCardSelector(
                              entryDrafts[entry.id]?.cardId ?? entry.card_id ?? "none",
                              async (value) => {
                                setEntryDrafts((state) => ({
                                  ...state,
                                  [entry.id]: { ...state[entry.id], cardId: value },
                                }));
                                await supabase.from("entries").update({ card_id: value === "none" ? null : value }).eq("id", entry.id);
                                if (householdId) await loadMonth(householdId, month);
                              }
                            )}
                            <Input
                              value={entryDrafts[entry.id]?.note ?? ""}
                              onChange={(e) =>
                                setEntryDrafts((state) => ({
                                  ...state,
                                  [entry.id]: { ...state[entry.id], note: e.target.value },
                                }))
                              }
                              onBlur={() => updateEntryDraft(entry.id)}
                              placeholder="note"
                            />
                            <Button variant="outline" size="sm" onClick={() => deleteEntry(entry.id)}>
                              Delete
                            </Button>
                          </div>
                        ))}
                      </div>

                      <div className="grid gap-2 border-t pt-3 md:grid-cols-[1fr_1fr_2fr_auto]">
                        <Input
                          placeholder="amount (12.5+8 = sum)"
                          value={quickState.amount}
                          onChange={(e) =>
                            setQuick((state) => ({
                              ...state,
                              [category.id]: { ...quickState, amount: e.target.value },
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key !== "Enter") return;
                            e.preventDefault();
                            const parts = parseAmountExpression(quickState.amount);
                            if (!parts) return;
                            addEntry(category.id, parts, quickState.cardId, quickState.note, e.shiftKey && parts.length > 1);
                          }}
                          inputMode="decimal"
                          className="tabular-nums"
                        />
                        {renderCardSelector(
                          quickState.cardId,
                          (value) =>
                            setQuick((state) => ({
                              ...state,
                              [category.id]: { ...quickState, cardId: value },
                            }))
                        )}
                        <Input
                          placeholder="note"
                          value={quickState.note}
                          onChange={(e) =>
                            setQuick((state) => ({
                              ...state,
                              [category.id]: { ...quickState, note: e.target.value },
                            }))
                          }
                        />
                        <Button
                          size="sm"
                          onClick={() => {
                            const parts = parseAmountExpression(quickState.amount);
                            if (parts) addEntry(category.id, parts, quickState.cardId, quickState.note, false);
                          }}
                        >
                          Add
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">Enter adds total. Shift+Enter splits each part into its own entry.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="space-y-4">
          {[...cards, { id: "none", household_id: householdId, name: "No card", color: "#9ca3af", archived: false, sort_order: 999 }].map((card) => {
            const cardEntries = entries.filter((entry) => (entry.card_id ?? "none") === card.id);
            const subtotal = cardTotals.get(card.id) ?? 0;
            const quickState = quick[`card:${card.id}`] ?? { amount: "", cardId: card.id, note: "", categoryId: activeCategories[0]?.id ?? "" };
            return (
              <Card key={card.id}>
                <CardContent className="p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="h-4 w-4 rounded-full" style={{ backgroundColor: card.color }} />
                      <span className="font-medium">{card.name}</span>
                      <Badge variant="secondary" className="tabular-nums">{money(subtotal)}</Badge>
                    </div>
                    <span className="text-sm text-muted-foreground">{cardEntries.length} entries</span>
                  </div>
                  <div className="space-y-2">
                    {cardEntries.map((entry) => (
                      <div key={entry.id} className="grid gap-2 md:grid-cols-[1.5fr_1fr_1fr_2fr_auto]">
                        <select
                          value={entry.category_id}
                          onChange={async (e) => {
                            await supabase.from("entries").update({ category_id: e.target.value }).eq("id", entry.id);
                            if (householdId) await loadMonth(householdId, month);
                          }}
                          className="h-9 rounded-md border bg-background px-2 text-sm"
                        >
                          {activeCategories.map((category) => (
                            <option key={category.id} value={category.id}>{category.name}</option>
                          ))}
                        </select>
                        <Input
                          value={entryDrafts[entry.id]?.amount ?? ""}
                          onChange={(e) =>
                            setEntryDrafts((state) => ({
                              ...state,
                              [entry.id]: { ...state[entry.id], amount: e.target.value },
                            }))
                          }
                          onBlur={() => updateEntryDraft(entry.id)}
                          inputMode="decimal"
                          className="tabular-nums"
                        />
                        {renderCardSelector(entryDrafts[entry.id]?.cardId ?? entry.card_id ?? "none", async (value) => {
                          setEntryDrafts((state) => ({ ...state, [entry.id]: { ...state[entry.id], cardId: value } }));
                          await supabase.from("entries").update({ card_id: value === "none" ? null : value }).eq("id", entry.id);
                          if (householdId) await loadMonth(householdId, month);
                        })}
                        <Input
                          value={entryDrafts[entry.id]?.note ?? ""}
                          onChange={(e) =>
                            setEntryDrafts((state) => ({
                              ...state,
                              [entry.id]: { ...state[entry.id], note: e.target.value },
                            }))
                          }
                          onBlur={() => updateEntryDraft(entry.id)}
                          placeholder="note"
                        />
                        <Button variant="outline" size="sm" onClick={() => deleteEntry(entry.id)}>Delete</Button>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 grid gap-2 border-t pt-3 md:grid-cols-[1.5fr_1fr_1fr_2fr_auto]">
                    <select
                      value={quickState.categoryId ?? activeCategories[0]?.id}
                      onChange={(e) =>
                        setQuick((state) => ({
                          ...state,
                          [`card:${card.id}`]: { ...quickState, categoryId: e.target.value },
                        }))
                      }
                      className="h-9 rounded-md border bg-background px-2 text-sm"
                    >
                      {activeCategories.map((category) => (
                        <option key={category.id} value={category.id}>{category.name}</option>
                      ))}
                    </select>
                    <Input
                      placeholder="amount"
                      value={quickState.amount}
                      onChange={(e) =>
                        setQuick((state) => ({
                          ...state,
                          [`card:${card.id}`]: { ...quickState, amount: e.target.value },
                        }))
                      }
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        const parts = parseAmountExpression(quickState.amount);
                        if (!parts) return;
                        const categoryId = quickState.categoryId ?? activeCategories[0]?.id;
                        if (!categoryId) return;
                        addEntry(categoryId, parts, card.id === "none" ? "none" : card.id, quickState.note, e.shiftKey && parts.length > 1);
                      }}
                      inputMode="decimal"
                      className="tabular-nums"
                    />
                    {renderCardSelector(
                      quickState.cardId,
                      (value) =>
                        setQuick((state) => ({
                          ...state,
                          [`card:${card.id}`]: { ...quickState, cardId: value },
                        }))
                    )}
                    <Input
                      placeholder="note"
                      value={quickState.note}
                      onChange={(e) =>
                        setQuick((state) => ({
                          ...state,
                          [`card:${card.id}`]: { ...quickState, note: e.target.value },
                        }))
                      }
                    />
                    <Button
                      size="sm"
                      onClick={() => {
                        const parts = parseAmountExpression(quickState.amount);
                        const categoryId = quickState.categoryId ?? activeCategories[0]?.id;
                        if (!parts || !categoryId) return;
                        addEntry(categoryId, parts, card.id === "none" ? "none" : card.id, quickState.note, false);
                      }}
                    >
                      Add
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <section className="mt-8">
        <Card>
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Income</h2>
              <span className="font-semibold tabular-nums text-green-600">{money(incomeTotal)}</span>
            </div>
            <div className="space-y-2">
              {incomeItems.map((item) => (
                <div key={item.id} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                  <Input value={incomeDrafts[item.id]?.source ?? item.source} onChange={(e) => setIncomeDrafts((state) => ({ ...state, [item.id]: { ...state[item.id], source: e.target.value } }))} onBlur={() => updateIncomeItem(item.id, incomeDrafts[item.id]?.source ?? item.source, incomeDrafts[item.id]?.amount ?? String(item.amount))} />
                  <Input value={incomeDrafts[item.id]?.amount ?? String(item.amount)} onChange={(e) => setIncomeDrafts((state) => ({ ...state, [item.id]: { ...state[item.id], amount: e.target.value } }))} onBlur={() => updateIncomeItem(item.id, incomeDrafts[item.id]?.source ?? item.source, incomeDrafts[item.id]?.amount ?? String(item.amount))} className="tabular-nums" />
                  <Button variant="outline" size="sm" onClick={() => deleteIncomeItem(item.id)}>Delete</Button>
                </div>
              ))}
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_auto]">
              <Input value={newIncome.source} onChange={(e) => setNewIncome((state) => ({ ...state, source: e.target.value }))} placeholder="source" />
              <Input value={newIncome.amount} onChange={(e) => setNewIncome((state) => ({ ...state, amount: e.target.value }))} className="tabular-nums" placeholder="amount" />
              <Button size="sm" onClick={addIncomeItem}>Add income</Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
