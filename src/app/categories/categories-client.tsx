"use client";

import { createElement, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ChevronLeft, ChevronRight, Eye, EyeOff, MoreHorizontal, Pencil, Plus, Settings2, Trash2 } from "lucide-react";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "cn";
import { money } from "@/lib/money";
import { monthLabel, shiftMonth } from "@/lib/month";
import { categoryIcon } from "@/lib/category-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
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
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  addCard,
  addCategory,
  addGroup,
  deleteCard,
  deleteCategory,
  deleteGroup,
  moveCategory,
  moveGroup,
  saveIdealWindow,
  setCategoryGroup,
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
  group_id: string | null;
  ideal_override: number | null;
  ideal: number;
};
type Group = { id: string; name: string; color: string; sort_order: number };
type CardItem = { id: string; name: string; color: string; sort_order: number; archived: boolean };
type Total = { category_id: string; month: string; total: number };

const PALETTE = ["#d85700", "#f2a65a", "#8c3b00", "#b8865a", "#6b7280", "#9ca3af", "#4b5563", "#d1a37a", "#a15c1e"];

function shortMonth(key: string) {
  return new Date(key + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
}

export function CategoriesClient({
  month,
  idealWindow,
  categories,
  groups,
  cards,
  totals,
}: {
  month: string;
  idealWindow: string;
  categories: Category[];
  groups: Group[];
  cards: CardItem[];
  totals: Total[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [categoryDialog, setCategoryDialog] = useState<{ editing: Category | null } | null>(null);
  const [groupDialog, setGroupDialog] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

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
  const spentRegular = useMemo(
    () => regular.reduce((sum, category) => sum + (spentByCategory.get(category.id) ?? 0), 0),
    [regular, spentByCategory]
  );
  const budgetRegular = useMemo(() => regular.reduce((sum, category) => sum + category.ideal, 0), [regular]);

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

  const pieData = useMemo(() => {
    const rows = regular
      .map((category) => ({ name: category.name, value: spentByCategory.get(category.id) ?? 0, color: category.color }))
      .filter((row) => row.value > 0)
      .sort((a, b) => b.value - a.value);
    if (rows.length <= 6) return rows;
    const rest = rows.slice(6).reduce((sum, row) => sum + row.value, 0);
    return [...rows.slice(0, 6), { name: "Other", value: rest, color: "#6b7280" }];
  }, [regular, spentByCategory]);

  const regularIds = useMemo(() => new Set(regular.map((category) => category.id)), [regular]);

  const chartData = useMemo(() => {
    const months = [...new Set(totals.map((row) => row.month))].filter((m) => m <= month).sort().slice(-12);
    return months.map((m) => ({
      month: shortMonth(m),
      total: totals.filter((row) => row.month === m && regularIds.has(row.category_id)).reduce((sum, row) => sum + row.total, 0),
    }));
  }, [totals, month, regularIds]);

  const keyMetrics = useMemo(() => {
    const years = [...new Set(totals.map((row) => row.month.slice(0, 4)))].sort().reverse().slice(0, 3);
    return years.map((year) => {
      const rows = totals.filter((row) => row.month.startsWith(year) && regularIds.has(row.category_id));
      const total = rows.reduce((sum, row) => sum + row.total, 0);
      const activeMonths = new Set(rows.filter((row) => row.total > 0).map((row) => row.month)).size || 1;
      return { year, total, avg: total / activeMonths };
    });
  }, [totals, regularIds]);

  const listCategories = useMemo(
    () =>
      regular
        .map((category) => ({ category, spent: spentByCategory.get(category.id) ?? 0 }))
        .sort((a, b) => b.spent - a.spent),
    [regular, spentByCategory]
  );

  return (
    <>
      <PageHeader title="Categories" description={monthLabel(month)}>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" aria-label="Previous month" onClick={() => router.push(`/categories?month=${shiftMonth(month, -1)}`)}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Next month" onClick={() => router.push(`/categories?month=${shiftMonth(month, 1)}`)}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <Button size="sm" onClick={() => setCategoryDialog({ editing: null })}>
          <Plus className="size-4" /> New category
        </Button>
        <Button size="sm" variant="outline" onClick={() => setGroupDialog(true)}>
          <Plus className="size-4" /> New group
        </Button>
        <Button size="sm" variant="outline" onClick={() => setManageOpen(true)}>
          <Settings2 className="size-4" /> Manage
        </Button>
      </PageHeader>

      <div className="grid gap-4 p-4 md:p-8 lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
        <div className="space-y-4">
          {error && <p className="text-sm text-destructive">{error}</p>}

          <Card>
            <CardContent className="space-y-4 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Spent in {monthLabel(month)}</p>
                  <p className="text-2xl font-semibold tabular-nums">{money(spentRegular)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Total budget</p>
                  <p className="text-lg font-medium tabular-nums">{money(budgetRegular)}</p>
                </div>
              </div>

              <div className="h-40">
                {pieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="100%" paddingAngle={2} strokeWidth={0}>
                        {pieData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => money(Number(value))} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="grid h-full place-items-center text-sm text-muted-foreground">No spending this month.</div>
                )}
              </div>

              <div className="flex items-center justify-between border-t pt-3 text-sm">
                <span className="text-muted-foreground">Left to spend</span>
                <span className={cn("font-medium tabular-nums", budgetRegular - spentRegular < 0 && "text-destructive")}>
                  {money(budgetRegular - spentRegular)}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 p-4">
              <h2 className="text-sm font-semibold">Regular categories</h2>
              {groupsWithCategories.length === 0 && <p className="text-sm text-muted-foreground">No expense categories yet.</p>}
              {groupsWithCategories.map(({ group, categories: groupCategories }) => {
                const groupBudget = groupCategories.reduce((sum, category) => sum + category.ideal, 0);
                const groupSpent = groupCategories.reduce((sum, category) => sum + spentOf(category.id), 0);
                return (
                  <div key={group.id || "ungrouped"} className="space-y-1">
                    <div
                      className="group-tint flex items-center gap-2 rounded-md px-2 py-1"
                      style={{ "--group-color": group.color } as React.CSSProperties}
                    >
                      <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: group.color }} />
                      <span className="min-w-0 truncate text-sm font-medium">{group.name}</span>
                      <Badge variant="secondary" className="shrink-0">{groupCategories.length}</Badge>
                      <span className="ml-auto shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                        {money(groupSpent)} / {money(groupBudget)}
                      </span>
                    </div>
                    <div className="space-y-0.5">
                      {groupCategories.map((category) => (
                        <CategoryRow
                          key={category.id}
                          category={category}
                          spent={spentOf(category.id)}
                          groups={groups}
                          onAction={run}
                          onEdit={() => setCategoryDialog({ editing: category })}
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
                  {excluded.map((category) => {
                    return (
                      <div key={category.id} className="flex items-center gap-2 rounded-md px-1 py-1 text-sm">
                        {createElement(categoryIcon(category.name), { className: "size-4 text-muted-foreground" })}
                        <span className="min-w-0 flex-1 truncate">{category.name}</span>
                        <span className="tabular-nums text-muted-foreground">{money(spentOf(category.id))}</span>
                        <Button variant="ghost" size="icon-xs" aria-label="Include in budget" onClick={() => run(setExcluded(category.id, false))}>
                          <Eye className="size-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">All regular categories</h2>
                <Badge variant="secondary">{regular.length}</Badge>
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Spent</p>
                  <p className="text-lg font-medium tabular-nums">{money(spentRegular)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Budget</p>
                  <p className="text-lg font-medium tabular-nums">{money(budgetRegular)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Left</p>
                  <p className={cn("text-lg font-medium tabular-nums", budgetRegular - spentRegular < 0 && "text-destructive")}>
                    {money(budgetRegular - spentRegular)}
                  </p>
                </div>
              </div>
              <div className="h-2 overflow-hidden rounded bg-muted">
                <div
                  className={cn("h-full", budgetRegular - spentRegular < 0 ? "bg-destructive" : "bg-emerald-500")}
                  style={{ width: `${budgetRegular > 0 ? Math.min(100, (spentRegular / budgetRegular) * 100) : spentRegular > 0 ? 100 : 0}%` }}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-4">
              <h2 className="text-sm font-semibold">Monthly spending</h2>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} />
                    <YAxis tickLine={false} axisLine={false} fontSize={12} width={48} />
                    <Tooltip formatter={(value) => money(Number(value))} />
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

          <Card>
            <CardContent className="space-y-1 p-4">
              <h2 className="pb-2 text-sm font-semibold">Regular categories</h2>
              <div className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
                {listCategories.map(({ category, spent }) => {
                  return (
                    <div key={category.id} className="grid grid-cols-[1.25rem_1fr_auto_auto] items-center gap-2 rounded px-1 py-0.5 text-sm">
                      {createElement(categoryIcon(category.name), { className: "size-4 text-muted-foreground" })}
                      <span className="truncate">{category.name}</span>
                      <span className="tabular-nums">{money(spent)}</span>
                      <span className="tabular-nums text-muted-foreground">{money(category.ideal)}</span>
                    </div>
                  );
                })}
                {listCategories.length === 0 && <p className="text-sm text-muted-foreground">Nothing to show.</p>}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {categoryDialog && (
        <CategoryDialog
          key={categoryDialog.editing?.id ?? "new"}
          editing={categoryDialog.editing}
          groups={groups}
          onClose={() => setCategoryDialog(null)}
          onSave={async (payload) => {
            if (categoryDialog.editing) {
              return run(
                updateCategory(categoryDialog.editing.id, {
                  name: payload.name,
                  kind: payload.kind,
                  color: payload.color,
                  group_id: payload.group_id,
                  ideal_override: payload.ideal_override,
                })
              );
            }
            const ok = await run(addCategory({ name: payload.name, kind: payload.kind, color: payload.color }));
            return ok;
          }}
        />
      )}

      {groupDialog && (
        <GroupDialog
          onClose={() => setGroupDialog(false)}
          onSave={(payload) => run(addGroup(payload))}
        />
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
  groups,
  onAction,
  onEdit,
}: {
  category: Category;
  spent: number;
  groups: Group[];
  onAction: (promise: Promise<ActionResult>) => Promise<boolean>;
  onEdit: () => void;
}) {
  return (
    <div className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/50">
      {createElement(categoryIcon(category.name), { className: "size-4 shrink-0 text-muted-foreground" })}
      <span className="min-w-0 flex-1 truncate text-sm">{category.name}</span>
      <span className="w-16 shrink-0 text-right text-xs tabular-nums">{money(spent)}</span>
      <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{money(category.ideal)}</span>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-xs" aria-label={`Options for ${category.name}`} className="opacity-0 group-hover:opacity-100 data-[popup-open]:opacity-100" />
          }
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onEdit}>
            <Pencil className="size-4" /> Edit
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Move to group</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={() => onAction(setCategoryGroup(category.id, null))}>No group</DropdownMenuItem>
              {groups.map((group) => (
                <DropdownMenuItem key={group.id} onClick={() => onAction(setCategoryGroup(category.id, group.id))}>
                  {group.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onAction(moveCategory(category.id, -1))}>Move up</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAction(moveCategory(category.id, 1))}>Move down</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onAction(setExcluded(category.id, true))}>
            <EyeOff className="size-4" /> Exclude from budget
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAction(updateCategory(category.id, { archived: true }))}>
            <Archive className="size-4" /> Archive
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => onAction(deleteCategory(category.id))}>
            <Trash2 className="size-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function CategoryDialog({
  editing,
  groups,
  onClose,
  onSave,
}: {
  editing: Category | null;
  groups: Group[];
  onClose: () => void;
  onSave: (payload: {
    name: string;
    kind: CategoryKind;
    color: string;
    group_id: string | null;
    ideal_override: number | null;
  }) => Promise<boolean>;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [kind, setKind] = useState<CategoryKind>(editing?.kind ?? "expense");
  const [color, setColor] = useState(editing?.color ?? PALETTE[0]);
  const [groupId, setGroupId] = useState(editing?.group_id ?? "");
  const [budget, setBudget] = useState(editing?.ideal_override == null ? "" : String(editing.ideal_override));
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const ok = await onSave({
      name,
      kind,
      color,
      group_id: groupId || null,
      ideal_override: budget.trim() === "" ? null : Number(budget),
    });
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit category" : "New category"}</DialogTitle>
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
            <Label htmlFor="category-group">Group</Label>
            <select
              id="category-group"
              value={groupId}
              onChange={(event) => setGroupId(event.target.value)}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            >
              <option value="">No group</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="category-budget">Monthly budget override</Label>
            <Input
              id="category-budget"
              type="number"
              min="0"
              step="0.01"
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
              placeholder="Leave blank to use the trailing average"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {editing ? "Save" : "Add"}
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
                <Button variant="ghost" size="icon-sm" aria-label="Move up" onClick={() => onAction(moveGroup(group.id, -1))}>
                  <ChevronLeft className="size-4 rotate-90" />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label="Move down" onClick={() => onAction(moveGroup(group.id, 1))}>
                  <ChevronRight className="size-4 rotate-90" />
                </Button>
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
