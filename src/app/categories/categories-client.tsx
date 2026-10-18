"use client";

import { createElement, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  Eye,
  GripVertical,
  ListChecks,
  Plus,
  Repeat,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "cn";
import { money } from "@/lib/money";
import { monthLabel, shiftMonth } from "@/lib/month";
import { CATEGORY_ICONS, CATEGORY_ICON_NAMES, categoryIcon } from "@/lib/category-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MonthNav } from "@/components/month-nav";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  addCard,
  addCategory,
  addGroup,
  deleteCard,
  deleteCategory,
  deleteGroup,
  reorderCategories,
  reorderGroups,
  saveIdealWindow,
  setCategoryGroup,
  setCategoryRecurring,
  setExcluded,
  updateCard,
  updateCategory,
  updateGroup,
  type ActionResult,
  type CategoryKind,
} from "./actions";

type Category = {
  id: string;
  name: string;
  color: string;
  kind: CategoryKind;
  sort_order: number;
  archived: boolean;
  excluded: boolean;
  no_ideal: boolean;
  group_id: string | null;
  ideal_override: number | null;
  ideal: number;
  icon: string | null;
};
type Group = { id: string; name: string; color: string; sort_order: number };
type CardItem = { id: string; name: string; color: string; sort_order: number; archived: boolean };
type Total = { category_id: string; month: string; total: number };
type Recurring = { id: string; amount: number; card_id: string | null };

const PALETTE = ["#d85700", "#f2a65a", "#8c3b00", "#b8865a", "#6b7280", "#9ca3af", "#4b5563", "#d1a37a", "#a15c1e"];

const PERIODS = [
  { key: "3M", months: 3 },
  { key: "6M", months: 6 },
  { key: "12M", months: 12 },
  { key: "YTD", months: 0 },
] as const;
type Period = (typeof PERIODS)[number]["key"];

function shortMonth(key: string) {
  return new Date(key + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
}

export function CategoriesClient({
  month,
  months,
  idealWindow,
  categories,
  groups,
  cards,
  totals,
  recurring,
}: {
  month: string;
  months: string[];
  idealWindow: string;
  categories: Category[];
  groups: Group[];
  cards: CardItem[];
  totals: Total[];
  recurring: Record<string, Recurring>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("12M");
  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [groupDialog, setGroupDialog] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [dragCat, setDragCat] = useState<string | null>(null);
  const [overCat, setOverCat] = useState<string | null>(null);
  const [dragGroup, setDragGroup] = useState<string | null>(null);
  const [overGroup, setOverGroup] = useState<string | null>(null);

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

  const expense = useMemo(
    () => categories.filter((category) => category.kind === "expense" && !category.archived),
    [categories]
  );
  const regular = useMemo(() => expense.filter((category) => !category.excluded), [expense]);
  const excluded = useMemo(() => expense.filter((category) => category.excluded), [expense]);

  const spentByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of totals) {
      if (row.month !== month) continue;
      map.set(row.category_id, (map.get(row.category_id) ?? 0) + row.total);
    }
    return map;
  }, [totals, month]);

  const spentOf = (id: string) => spentByCategory.get(id) ?? 0;

  const groupsWithCategories = useMemo(() => {
    const known = new Set(groups.map((group) => group.id));
    const list = groups.map((group) => ({
      group,
      categories: regular.filter((category) => category.group_id === group.id),
    }));
    const ungrouped = regular.filter((category) => !category.group_id || !known.has(category.group_id));
    if (ungrouped.length > 0) {
      list.push({ group: { id: "", name: "Ungrouped", color: "#6b7280", sort_order: 9999 }, categories: ungrouped });
    }
    return list.filter((entry) => entry.categories.length > 0);
  }, [groups, regular]);

  const regularIds = useMemo(() => new Set(regular.map((category) => category.id)), [regular]);

  const chartData = useMemo(() => {
    const periodMonths =
      period === "YTD"
        ? (() => {
            const list: string[] = [];
            let cursor = `${month.slice(0, 4)}-01-01`;
            while (cursor <= month) {
              list.push(cursor);
              cursor = shiftMonth(cursor, 1);
            }
            return list;
          })()
        : Array.from({ length: PERIODS.find((entry) => entry.key === period)?.months ?? 12 }, (_, index) =>
            shiftMonth(month, index - ((PERIODS.find((entry) => entry.key === period)?.months ?? 12) - 1))
          );
    return periodMonths.map((m) => ({
      month: shortMonth(m),
      total: totals.filter((row) => row.month === m && regularIds.has(row.category_id)).reduce((sum, row) => sum + row.total, 0),
    }));
  }, [totals, month, period, regularIds]);

  const keyMetrics = useMemo(() => {
    const years = [...new Set(totals.map((row) => row.month.slice(0, 4)))].sort().reverse().slice(0, 3);
    return years.map((year) => {
      const rows = totals.filter((row) => row.month.startsWith(year) && regularIds.has(row.category_id));
      const total = rows.reduce((sum, row) => sum + row.total, 0);
      const activeMonths = new Set(rows.filter((row) => row.total > 0).map((row) => row.month)).size || 1;
      return { year, total, avg: total / activeMonths };
    });
  }, [totals, regularIds]);

  const selected = useMemo(() => {
    if (selectedId) {
      const found = categories.find((category) => category.id === selectedId);
      if (found) return found;
    }
    return regular[0] ?? null;
  }, [selectedId, categories, regular]);

  const selectedGroup = selected ? groups.find((group) => group.id === selected.group_id) ?? null : null;

  function toggleRecurring(category: Category, enabled: boolean) {
    if (enabled) setSelectedId(category.id);
    run(setCategoryRecurring(category.id, { enabled }));
  }

  function groupIdOf(id: string) {
    for (const entry of groupsWithCategories) {
      if (entry.categories.some((category) => category.id === id)) return entry.group.id;
    }
    return null;
  }

  function dropCategory(targetId: string) {
    const source = dragCat;
    setDragCat(null);
    setOverCat(null);
    if (!source || source === targetId) return;
    if (groupIdOf(source) !== groupIdOf(targetId)) return;
    const displayIds = groupsWithCategories.flatMap((entry) => entry.categories.map((category) => category.id));
    const from = displayIds.indexOf(source);
    const to = displayIds.indexOf(targetId);
    if (from < 0 || to < 0) return;
    displayIds.splice(from, 1);
    displayIds.splice(to, 0, source);
    run(reorderCategories([...displayIds, ...excluded.map((category) => category.id)]));
  }

  function dropGroup(targetId: string) {
    const source = dragGroup;
    setDragGroup(null);
    setOverGroup(null);
    if (!source || source === targetId) return;
    const ids = groups.map((group) => group.id);
    const from = ids.indexOf(source);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, source);
    run(reorderGroups(ids));
  }

  return (
    <>
      <div className="relative grid grid-cols-1 items-center gap-3 p-4 md:p-8 md:pb-0 lg:grid-cols-[1fr_auto_1fr]">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h1 className="text-2xl font-semibold">Categories</h1>
          <p className="text-sm text-muted-foreground">{monthLabel(month)}</p>
          {isPending && <span className="text-sm text-muted-foreground">updating…</span>}
        </div>
        <div className="flex justify-center">
          <MonthNav value={month} months={months} onSelect={(value) => router.push(`/categories?month=${value}`)} />
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" onClick={() => setNewCategoryOpen(true)}>
            <Plus className="size-4" /> New category
          </Button>
          <Button size="sm" variant="outline" onClick={() => setGroupDialog(true)}>
            <Plus className="size-4" /> New group
          </Button>
          <Button size="sm" variant="outline" onClick={() => setManageOpen(true)}>
            <Settings2 className="size-4" /> Manage
          </Button>
        </div>
      </div>

      <div className="p-4 md:p-8">
        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,36rem)_minmax(0,1fr)]">
          <div className="space-y-4">
            <Card>
              <CardContent className="space-y-1 p-4">
                <div className="-mx-4 flex items-center gap-2 px-5 py-1">
                  <span className="min-w-0 truncate text-base font-bold">Regular categories</span>
                  <span className="ml-auto flex shrink-0 items-center gap-2 whitespace-nowrap text-xs">
                    <span className="w-20 text-right text-muted-foreground">Spending</span>
                    <span className="w-20 text-right text-muted-foreground">Ideal</span>
                    <span className="w-6" aria-hidden />
                  </span>
                </div>
                {groupsWithCategories.length === 0 && (
                  <p className="pt-2 text-sm text-muted-foreground">No expense categories yet.</p>
                )}
                {groupsWithCategories.map(({ group, categories: groupCategories }) => {
                  const groupBudget = groupCategories.reduce((sum, category) => sum + category.ideal, 0);
                  const groupSpent = groupCategories.reduce((sum, category) => sum + spentOf(category.id), 0);
                  return (
                    <div key={group.id || "ungrouped"} className="space-y-1 pt-1">
                      <div
                        className={cn(
                          "group-tint group -mx-4 flex items-center gap-2 rounded-lg px-5 py-1",
                          dragGroup === group.id && "opacity-50",
                          overGroup === group.id && "ring-2 ring-inset ring-primary"
                        )}
                        style={{ "--group-color": group.color } as React.CSSProperties}
                        onDragOver={(event) => {
                          if (!dragGroup || !group.id || dragGroup === group.id) return;
                          event.preventDefault();
                          setOverGroup(group.id);
                        }}
                        onDrop={(event) => {
                          if (!dragGroup || !group.id) return;
                          event.preventDefault();
                          dropGroup(group.id);
                        }}
                      >
                        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: group.color }} />
                        <span className="min-w-0 truncate text-base font-bold">{group.name}</span>
                        <Badge variant="secondary" className="shrink-0">{groupCategories.length}</Badge>
                        <span className="ml-auto flex shrink-0 items-center gap-2 whitespace-nowrap text-xs tabular-nums">
                          <span className="w-20 text-right">{money(groupSpent)}</span>
                          <span className="w-20 text-right text-muted-foreground">{money(groupBudget)}</span>
                          {group.id ? (
                            <span
                              draggable
                              onDragStart={() => setDragGroup(group.id)}
                              onDragEnd={() => {
                                setDragGroup(null);
                                setOverGroup(null);
                              }}
                              title="Drag to reorder groups"
                              className="grid w-6 cursor-grab place-items-center text-muted-foreground opacity-0 group-hover:opacity-100 active:cursor-grabbing"
                            >
                              <GripVertical className="size-4" />
                            </span>
                          ) : (
                            <span className="w-6" aria-hidden />
                          )}
                        </span>
                      </div>
                      <div className="space-y-0.5">
                        {groupCategories.map((category) => (
                          <CategoryRow
                            key={category.id}
                            category={category}
                            spent={spentOf(category.id)}
                            selected={selected?.id === category.id}
                            recurringOn={Boolean(recurring[category.id])}
                            onSelect={() => setSelectedId(category.id)}
                            onToggleRecurring={(enabled) => toggleRecurring(category, enabled)}
                            dragging={dragCat === category.id}
                            dropTarget={overCat === category.id}
                            onDragStart={() => setDragCat(category.id)}
                            onDragEnd={() => {
                              setDragCat(null);
                              setOverCat(null);
                            }}
                            onDragOver={() => {
                              if (dragCat && dragCat !== category.id && groupIdOf(dragCat) === group.id) {
                                setOverCat(category.id);
                              }
                            }}
                            onDrop={() => dropCategory(category.id)}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {excluded.length > 0 && (
              <Card>
                <CardContent className="space-y-2 p-4">
                  <h2 className="text-sm font-semibold">Excluded categories</h2>
                  <p className="text-xs text-muted-foreground">Not counted toward the budget total.</p>
                  <div className="space-y-0.5">
                    {excluded.map((category) => (
                      <div key={category.id} className="flex items-center gap-2 rounded-md px-1 py-1 text-sm">
                        {createElement(categoryIcon(category), { className: "size-4 text-muted-foreground" })}
                        <span className="min-w-0 flex-1 truncate">{category.name}</span>
                        <span className="tabular-nums text-muted-foreground">{money(spentOf(category.id))}</span>
                        <Button variant="ghost" size="icon-xs" aria-label="Include in budget" onClick={() => run(setExcluded(category.id, false))}>
                          <Eye className="size-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-4">
            <Card>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">Spending trend</h2>
                  <div className="flex items-center rounded-lg border bg-muted/40 p-0.5">
                    {PERIODS.map((entry) => (
                      <button
                        key={entry.key}
                        type="button"
                        onClick={() => setPeriod(entry.key)}
                        className={cn(
                          "rounded-md px-2.5 py-1 text-xs transition-colors",
                          period === entry.key
                            ? "bg-background font-medium text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {entry.key}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} />
                      <YAxis tickLine={false} axisLine={false} fontSize={12} width={48} />
                      <Tooltip formatter={(value) => money(Number(value))} cursor={{ fill: "transparent" }} />
                      <Bar dataKey="total" fill="var(--color-chart-2)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-3 p-4">
                <h2 className="text-sm font-semibold">Key metrics</h2>
                <div className="space-y-2">
                  {keyMetrics.map((metric) => (
                    <div key={metric.year} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Spent in {metric.year}</span>
                      <span className="tabular-nums font-medium">{money(metric.total)}</span>
                      <span className="tabular-nums text-muted-foreground">avg {money(metric.avg)}/mo</span>
                    </div>
                  ))}
                  {keyMetrics.length === 0 && <p className="text-sm text-muted-foreground">No history yet.</p>}
                </div>
              </CardContent>
            </Card>

            {selected ? (
              <CategoryDetail
                key={selected.id}
                category={selected}
                group={selectedGroup}
                groups={groups}
                recurring={recurring[selected.id]}
                cards={cards.filter((card) => !card.archived)}
                spent={spentOf(selected.id)}
                onAction={run}
                onViewAll={() => router.push(`/expenses?month=${month}&category=${selected.id}`)}
                onArchive={() => {
                  setSelectedId(null);
                  run(updateCategory(selected.id, { archived: true }));
                }}
              />
            ) : (
              <Card>
                <CardContent className="p-4 text-sm text-muted-foreground">Select a category to edit it.</CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {newCategoryOpen && (
        <CategoryDialog
          onClose={() => setNewCategoryOpen(false)}
          onSave={(payload) =>
            run(addCategory({ name: payload.name, kind: payload.kind, color: payload.color, icon: payload.icon }))
          }
        />
      )}

      {groupDialog && (
        <GroupDialog onClose={() => setGroupDialog(false)} onSave={(payload) => run(addGroup(payload))} />
      )}

      {manageOpen && (
        <ManageDialog
          idealWindow={idealWindow}
          groups={groups}
          cards={cards}
          archived={categories.filter((category) => category.archived)}
          error={error}
          onAction={run}
          onClose={() => setManageOpen(false)}
        />
      )}
    </>
  );
}

function CategoryRow({
  category,
  spent,
  selected,
  recurringOn,
  onSelect,
  onToggleRecurring,
  dragging,
  dropTarget,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  category: Category;
  spent: number;
  selected: boolean;
  recurringOn: boolean;
  onSelect: () => void;
  onToggleRecurring: (enabled: boolean) => void;
  dragging: boolean;
  dropTarget: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onDrop: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        onDragOver();
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
      className={cn(
        "group flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/50",
        selected && "bg-primary/10",
        dragging && "opacity-50",
        dropTarget && "ring-2 ring-inset ring-primary"
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {createElement(categoryIcon(category), { className: "size-4 shrink-0 text-muted-foreground" })}
        <span className="min-w-0 truncate text-sm">{category.name}</span>
        <button
          type="button"
          aria-label={recurringOn ? `Disable recurring for ${category.name}` : `Enable recurring for ${category.name}`}
          aria-pressed={recurringOn}
          title={recurringOn ? "Recurring on" : "Recurring off"}
          onClick={(event) => {
            event.stopPropagation();
            onToggleRecurring(!recurringOn);
          }}
          className={cn(
            "shrink-0 rounded p-0.5 transition-colors",
            recurringOn ? "text-primary" : "text-muted-foreground/20 hover:text-muted-foreground"
          )}
        >
          <Repeat className="size-4" />
        </button>
      </span>
      <span className="w-20 shrink-0 text-right text-xs tabular-nums">{money(spent)}</span>
      <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{category.no_ideal ? "" : money(category.ideal)}</span>
      <span
        draggable
        aria-label={`Reorder ${category.name}`}
        title="Drag to reorder"
        onClick={(event) => event.stopPropagation()}
        onDragStart={() => onDragStart()}
        onDragEnd={() => onDragEnd()}
        className="grid w-6 shrink-0 cursor-grab place-items-center text-muted-foreground opacity-0 group-hover:opacity-100 active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </span>
    </div>
  );
}

function CategoryDetail({
  category,
  group,
  groups,
  recurring,
  cards,
  spent,
  onAction,
  onViewAll,
  onArchive,
}: {
  category: Category;
  group: Group | null;
  groups: Group[];
  recurring: Recurring | undefined;
  cards: CardItem[];
  spent: number;
  onAction: (promise: Promise<ActionResult>) => Promise<boolean>;
  onViewAll: () => void;
  onArchive: () => void;
}) {
  const [iconQuery, setIconQuery] = useState("");
  const recurringOn = Boolean(recurring);
  const budgetOn = category.ideal_override != null;
  const effectiveBudget = category.ideal_override ?? category.ideal;
  const budgetDisplay = category.ideal_override != null ? category.ideal_override : Math.round(category.ideal);
  const difference = spent - category.ideal;
  const groupColor = group?.color ?? "#6b7280";
  const filteredIcons = useMemo(() => {
    const query = iconQuery.trim().toLowerCase();
    if (!query) return CATEGORY_ICON_NAMES;
    return CATEGORY_ICON_NAMES.filter((name) => name.toLowerCase().includes(query));
  }, [iconQuery]);

  function commitName(value: string) {
    const trimmed = value.trim();
    if (!trimmed || trimmed === category.name) return;
    onAction(updateCategory(category.id, { name: trimmed }));
  }

  function commitAmount(value: string) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) return;
    if (amount === recurring?.amount) return;
    onAction(setCategoryRecurring(category.id, { amount }));
  }

  function commitBudget(value: string) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) return;
    if (amount === category.ideal_override) return;
    onAction(updateCategory(category.id, { ideal_override: amount }));
  }

  function setIdeal(enabled: boolean) {
    if (enabled) {
      onAction(updateCategory(category.id, { no_ideal: false }));
    } else {
      onAction(updateCategory(category.id, { no_ideal: true, ideal_override: null }));
    }
  }

  function setCustomIdeal(enabled: boolean) {
    if (enabled) {
      onAction(updateCategory(category.id, { no_ideal: false, ideal_override: Math.round(effectiveBudget * 100) / 100 }));
    } else {
      onAction(updateCategory(category.id, { ideal_override: null }));
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start gap-3">
          <span
            className="grid size-9 shrink-0 place-items-center rounded-lg"
            style={{ backgroundColor: `${category.color}22`, color: category.color }}
          >
            {createElement(categoryIcon(category), { className: "size-5" })}
          </span>
          <div className="min-w-0">
            <h2 className="truncate font-heading text-lg font-bold">{category.name}</h2>
            <p className="truncate text-xs text-muted-foreground">{group?.name ?? "Ungrouped"}</p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            Regular category
            <span className="size-3 rounded-full" style={{ backgroundColor: groupColor }} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 border-y py-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Spending</p>
            <p className="text-lg font-semibold tabular-nums">{money(spent)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Ideal</p>
            <p className="text-lg font-semibold tabular-nums">{category.no_ideal ? "—" : money(category.ideal)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Difference</p>
            <p
              className={cn(
                "text-lg font-semibold tabular-nums",
                category.no_ideal
                  ? "text-muted-foreground"
                  : difference > 0
                    ? "text-red-600"
                    : "text-green-600"
              )}
            >
              {category.no_ideal ? "—" : money(difference)}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Details</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`detail-name-${category.id}`}>Category name</Label>
              <Input
                id={`detail-name-${category.id}`}
                key={category.name}
                defaultValue={category.name}
                onBlur={(event) => commitName(event.currentTarget.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`detail-group-${category.id}`}>Group</Label>
              <select
                id={`detail-group-${category.id}`}
                value={category.group_id ?? ""}
                onChange={(event) => onAction(setCategoryGroup(category.id, event.target.value || null))}
                className="h-8 w-full rounded-lg border bg-background px-2 text-sm"
              >
                <option value="">No group</option>
                {groups.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`detail-kind-${category.id}`}>Type</Label>
              <select
                id={`detail-kind-${category.id}`}
                value={category.kind}
                onChange={(event) => onAction(updateCategory(category.id, { kind: event.target.value as CategoryKind }))}
                className="h-8 w-full rounded-lg border bg-background px-2 text-sm"
              >
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>Color</Label>
              <div className="flex flex-wrap items-center gap-1.5">
                {PALETTE.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    aria-label={`Color ${swatch}`}
                    aria-pressed={category.color.toLowerCase() === swatch.toLowerCase()}
                    onClick={() => onAction(updateCategory(category.id, { color: swatch }))}
                    className={cn(
                      "size-5 rounded-full ring-2 ring-offset-2 ring-offset-card",
                      category.color.toLowerCase() === swatch.toLowerCase() ? "ring-foreground" : "ring-transparent"
                    )}
                    style={{ backgroundColor: swatch }}
                  />
                ))}
                <Input
                  type="color"
                  key={category.color}
                  defaultValue={category.color}
                  aria-label="Custom color"
                  className="h-7 w-10 shrink-0 p-1"
                  onBlur={(event) => {
                    const value = event.currentTarget.value;
                    if (value.toLowerCase() !== category.color.toLowerCase()) {
                      onAction(updateCategory(category.id, { color: value }));
                    }
                  }}
                />
              </div>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Icon</Label>
            <div className="flex items-center gap-2">
              <Input
                value={iconQuery}
                onChange={(event) => setIconQuery(event.target.value)}
                placeholder="Search icons"
                className="h-8"
              />
              <Button
                type="button"
                variant={category.icon === null ? "default" : "outline"}
                size="sm"
                onClick={() => onAction(updateCategory(category.id, { icon: null }))}
              >
                Auto
              </Button>
            </div>
            <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto rounded-md border p-2">
              {filteredIcons.map((iconName) => {
                const Icon = CATEGORY_ICONS[iconName];
                return (
                  <button
                    key={iconName}
                    type="button"
                    title={iconName}
                    aria-label={iconName}
                    aria-pressed={category.icon === iconName}
                    onClick={() => onAction(updateCategory(category.id, { icon: iconName }))}
                    className={cn(
                      "grid size-8 place-items-center rounded-md border",
                      category.icon === iconName
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-transparent hover:bg-muted"
                    )}
                  >
                    <Icon className="size-4" />
                  </button>
                );
              })}
              {filteredIcons.length === 0 && (
                <p className="px-1 py-2 text-xs text-muted-foreground">No icons match.</p>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t pt-3">
          <div>
            <h3 className="text-sm font-semibold">Excluded from budget</h3>
            <p className="text-xs text-muted-foreground">Not counted toward the budget total.</p>
          </div>
          <Switch
            checked={category.excluded}
            onCheckedChange={(checked) => onAction(setExcluded(category.id, checked))}
            aria-label="Excluded from budget"
          />
        </div>

        <div className="space-y-3 border-t pt-3">
          <div className="grid grid-cols-3 divide-x overflow-hidden rounded-lg border text-sm">
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="font-semibold">Recurring expense</span>
              <Switch
                checked={recurringOn}
                onCheckedChange={(checked) => onAction(setCategoryRecurring(category.id, { enabled: checked }))}
                aria-label="Recurring expense"
              />
            </div>
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="font-semibold">Custom ideal</span>
              <Switch
                checked={budgetOn}
                disabled={category.no_ideal}
                onCheckedChange={setCustomIdeal}
                aria-label="Custom ideal"
              />
            </div>
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="font-semibold">Ideal</span>
              <Switch checked={!category.no_ideal} onCheckedChange={setIdeal} aria-label="Ideal" />
            </div>
          </div>

          {recurringOn && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor={`detail-amount-${category.id}`} className="text-xs text-muted-foreground">
                  Monthly amount
                </Label>
                <div className="relative">
                  <Input
                    id={`detail-amount-${category.id}`}
                    key={recurring ? recurring.amount : "none"}
                    defaultValue={recurring ? recurring.amount : ""}
                    onBlur={(event) => commitAmount(event.currentTarget.value)}
                    inputMode="decimal"
                    className="pr-8 tabular-nums"
                  />
                  <button
                    type="button"
                    aria-label="Clear recurring amount"
                    onClick={() => onAction(setCategoryRecurring(category.id, { amount: 0 }))}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`detail-card-${category.id}`} className="text-xs text-muted-foreground">
                  Card
                </Label>
                <select
                  id={`detail-card-${category.id}`}
                  value={recurring?.card_id ?? "none"}
                  onChange={(event) =>
                    onAction(setCategoryRecurring(category.id, { card_id: event.target.value === "none" ? null : event.target.value }))
                  }
                  className="h-8 w-full rounded-lg border bg-background px-2 text-sm"
                >
                  <option value="none">No card</option>
                  {cards.map((card) => (
                    <option key={card.id} value={card.id}>{card.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {budgetOn && !category.no_ideal && (
            <div className="relative">
              <Input
                key={budgetDisplay}
                defaultValue={budgetDisplay}
                onBlur={(event) => commitBudget(event.currentTarget.value)}
                inputMode="decimal"
                className="pr-8 tabular-nums"
              />
              <button
                type="button"
                aria-label="Clear budget override"
                onClick={() => onAction(updateCategory(category.id, { ideal_override: null }))}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}

          {category.no_ideal && (
            <p className="text-xs text-muted-foreground">
              No ideal for this category. Spending still counts toward the group total.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between border-t pt-3">
          <Button variant="outline" size="sm" onClick={onViewAll}>
            <ListChecks className="size-4" /> View all transactions
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onArchive}>
              <Archive className="size-4" /> Archive
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => onAction(deleteCategory(category.id))}
            >
              <Trash2 className="size-4" /> Delete
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CategoryDialog({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (payload: {
    name: string;
    kind: CategoryKind;
    color: string;
    icon: string | null;
  }) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CategoryKind>("expense");
  const [color, setColor] = useState(PALETTE[0]);
  const [icon, setIcon] = useState<string | null>(null);
  const [iconQuery, setIconQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const filteredIcons = useMemo(() => {
    const query = iconQuery.trim().toLowerCase();
    if (!query) return CATEGORY_ICON_NAMES;
    return CATEGORY_ICON_NAMES.filter((name) => name.toLowerCase().includes(query));
  }, [iconQuery]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const ok = await onSave({ name, kind, color, icon });
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New category</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="category-name">Name</Label>
            <Input id="category-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="category-kind">Type</Label>
              <select
                id="category-kind"
                value={kind}
                onChange={(event) => setKind(event.target.value as CategoryKind)}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                <option value="expense">expense</option>
                <option value="income">income</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="category-color">Color</Label>
              <Input id="category-color" type="color" value={color} onChange={(event) => setColor(event.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Icon</Label>
            <div className="flex items-center gap-2">
              <Input
                value={iconQuery}
                onChange={(event) => setIconQuery(event.target.value)}
                placeholder="Search icons"
                className="h-8"
              />
              <Button
                type="button"
                variant={icon === null ? "default" : "outline"}
                size="sm"
                onClick={() => setIcon(null)}
              >
                Auto
              </Button>
            </div>
            <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto rounded-md border p-2">
              {filteredIcons.map((iconName) => {
                const Icon = CATEGORY_ICONS[iconName];
                return (
                  <button
                    key={iconName}
                    type="button"
                    title={iconName}
                    aria-label={iconName}
                    aria-pressed={icon === iconName}
                    onClick={() => setIcon(iconName)}
                    className={cn(
                      "grid size-8 place-items-center rounded-md border",
                      icon === iconName
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-transparent hover:bg-muted"
                    )}
                  >
                    <Icon className="size-4" />
                  </button>
                );
              })}
              {filteredIcons.length === 0 && (
                <p className="px-1 py-2 text-xs text-muted-foreground">No icons match.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function GroupDialog({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (payload: { name: string; color: string }) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[3]);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const ok = await onSave({ name, color });
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New group</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="group-name">Name</Label>
            <Input id="group-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </div>
          <div className="space-y-1">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {PALETTE.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  aria-label={`Color ${swatch}`}
                  aria-pressed={color === swatch}
                  onClick={() => setColor(swatch)}
                  className={cn(
                    "size-6 rounded-full ring-2 ring-offset-2 ring-offset-popover",
                    color === swatch ? "ring-foreground" : "ring-transparent"
                  )}
                  style={{ backgroundColor: swatch }}
                />
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ManageDialog({
  idealWindow,
  groups,
  cards,
  archived,
  error,
  onAction,
  onClose,
}: {
  idealWindow: string;
  groups: Group[];
  cards: CardItem[];
  archived: Category[];
  error: string | null;
  onAction: (promise: Promise<ActionResult>) => Promise<boolean>;
  onClose: () => void;
}) {
  const [newGroup, setNewGroup] = useState({ name: "", color: PALETTE[3] });
  const [newCard, setNewCard] = useState({ name: "", color: PALETTE[1] });
  const [confirmCard, setConfirmCard] = useState<string | null>(null);
  const activeCards = cards.filter((card) => !card.archived);
  const archivedCards = cards.filter((card) => card.archived);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage categories</DialogTitle>
        </DialogHeader>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Groups</h3>
          <div className="space-y-1">
            {groups.map((group) => (
              <div key={group.id} className="flex items-center gap-2">
                <span className="size-4 rounded-full" style={{ backgroundColor: group.color }} />
                <Input
                  defaultValue={group.name}
                  className="h-8"
                  onBlur={(event) => {
                    if (event.target.value.trim() && event.target.value.trim() !== group.name) {
                      onAction(updateGroup(group.id, { name: event.target.value }));
                    }
                  }}
                />
                <Input
                  type="color"
                  defaultValue={group.color}
                  className="w-10 shrink-0"
                  onBlur={(event) => onAction(updateGroup(group.id, { color: event.target.value }))}
                />
                <Button variant="ghost" size="icon-sm" aria-label="Delete group" onClick={() => onAction(deleteGroup(group.id))}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            {groups.length === 0 && <p className="text-sm text-muted-foreground">No groups yet.</p>}
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={async (event) => {
              event.preventDefault();
              const ok = await onAction(addGroup(newGroup));
              if (ok) setNewGroup({ name: "", color: PALETTE[3] });
            }}
          >
            <Input
              placeholder="New group"
              value={newGroup.name}
              onChange={(event) => setNewGroup((state) => ({ ...state, name: event.target.value }))}
            />
            <Input
              type="color"
              value={newGroup.color}
              className="w-10 shrink-0"
              onChange={(event) => setNewGroup((state) => ({ ...state, color: event.target.value }))}
            />
            <Button type="submit" size="sm">
              <Plus className="size-4" /> Add
            </Button>
          </form>
        </div>

        <div className="space-y-3 border-t pt-3">
          <h3 className="text-sm font-semibold">Payment methods</h3>
          <div className="space-y-1">
            {activeCards.map((card) => (
              <div key={card.id} className="flex items-center gap-2">
                <span className="size-4 rounded-full" style={{ backgroundColor: card.color }} />
                <Input
                  defaultValue={card.name}
                  className="h-8"
                  onBlur={(event) => {
                    const input = event.target;
                    const name = input.value.trim();
                    if (name && name !== card.name) {
                      onAction(updateCard(card.id, { name })).then((ok) => {
                        if (!ok) input.value = card.name;
                      });
                    }
                  }}
                />
                <Input
                  type="color"
                  defaultValue={card.color}
                  className="w-10 shrink-0"
                  onBlur={(event) => onAction(updateCard(card.id, { color: event.target.value }))}
                />
                {confirmCard === card.id ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="destructive" size="sm" onClick={() => onAction(deleteCard(card.id))}>
                      Delete
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmCard(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Archive payment method"
                      onClick={() => onAction(updateCard(card.id, { archived: true }))}
                    >
                      <Archive className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Delete payment method"
                      onClick={() => setConfirmCard(card.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </>
                )}
              </div>
            ))}
            {activeCards.length === 0 && <p className="text-sm text-muted-foreground">No payment methods yet.</p>}
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={async (event) => {
              event.preventDefault();
              const ok = await onAction(addCard(newCard));
              if (ok) setNewCard({ name: "", color: PALETTE[1] });
            }}
          >
            <Input
              placeholder="New payment method"
              value={newCard.name}
              onChange={(event) => setNewCard((state) => ({ ...state, name: event.target.value }))}
            />
            <Input
              type="color"
              value={newCard.color}
              className="w-10 shrink-0"
              onChange={(event) => setNewCard((state) => ({ ...state, color: event.target.value }))}
            />
            <Button type="submit" size="sm">
              <Plus className="size-4" /> Add
            </Button>
          </form>

          {archivedCards.length > 0 && (
            <div className="space-y-1 pt-1">
              <p className="text-xs text-muted-foreground">
                Archived payment methods stay on past entries but can&apos;t be picked for new ones.
              </p>
              {archivedCards.map((card) => (
                <div key={card.id} className="flex items-center gap-2 text-sm">
                  <span className="size-4 shrink-0 rounded-full" style={{ backgroundColor: card.color }} />
                  <span className="min-w-0 flex-1 truncate">{card.name}</span>
                  {confirmCard === card.id ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button variant="destructive" size="sm" onClick={() => onAction(deleteCard(card.id))}>
                        Delete
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmCard(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onAction(updateCard(card.id, { archived: false }))}
                      >
                        Restore
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Delete payment method"
                        onClick={() => setConfirmCard(card.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-3 border-t pt-3">
          <h3 className="text-sm font-semibold">Ideal spending window</h3>
          <select
            defaultValue={idealWindow}
            onChange={(event) => onAction(saveIdealWindow(event.target.value))}
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
          >
            <option value="trailing12">Trailing 12 months</option>
            <option value="trailing6">Trailing 6 months</option>
            <option value="all">All history</option>
          </select>
          <p className="text-xs text-muted-foreground">Months with zero spending are excluded from the average.</p>
        </div>

        {archived.length > 0 && (
          <div className="space-y-2 border-t pt-3">
            <h3 className="text-sm font-semibold">Archived</h3>
            {archived.map((category) => (
              <div key={category.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{category.name}</span>
                <Button variant="outline" size="sm" onClick={() => onAction(updateCategory(category.id, { archived: false }))}>
                  Unarchive
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label="Delete" onClick={() => onAction(deleteCategory(category.id))}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
