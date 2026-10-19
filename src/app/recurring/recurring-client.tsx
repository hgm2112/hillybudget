"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { money } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { addTemplate, deleteTemplate, toggleActive, updateTemplate, type ActionResult } from "./actions";

type Category = { id: string; name: string; color: string; archived: boolean };
type CardItem = { id: string; name: string; color: string; archived: boolean };
type Template = {
  id: string;
  category_id: string;
  card_id: string | null;
  amount: number;
  note: string | null;
  start_month: string;
  end_month: string | null;
  active: boolean;
};

export function RecurringClient({
  categories,
  cards,
  templates,
  defaultStartMonth,
}: {
  categories: Category[];
  cards: CardItem[];
  templates: Template[];
  defaultStartMonth: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [draft, setDraft] = useState(() => ({
    category_id: "",
    card_id: "none",
    amount: "",
    note: "",
    start_month: defaultStartMonth,
    end_month: "",
    active: true,
  }));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function run(promise: Promise<ActionResult>) {
    setBusy(true);
    setError(null);
    const result = await promise;
    setBusy(false);
    if (result?.error) {
      setError(result.error);
      return false;
    }
    refresh();
    return true;
  }

  const activeCategories = useMemo(() => categories.filter((category) => !category.archived), [categories]);
  const activeCards = useMemo(() => cards.filter((card) => !card.archived), [cards]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const amount = Number(draft.amount);
    const ok = await run(
      addTemplate({
        category_id: draft.category_id,
        card_id: draft.card_id === "none" ? null : draft.card_id,
        amount,
        note: draft.note || null,
        start_month: draft.start_month,
        end_month: draft.end_month || null,
        active: draft.active,
      })
    );
    if (ok) {
      setDraft({ category_id: "", card_id: "none", amount: "", note: "", start_month: draft.start_month, end_month: "", active: true });
    }
  }

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Recurring items</h1>
        <p className="text-sm text-muted-foreground">Fixed monthly items that generate entries on demand.</p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Card>
        <CardContent className="p-4">
          <h2 className="mb-3 text-lg font-semibold">Add template</h2>
          <form onSubmit={submit} className="grid gap-2 md:grid-cols-4">
            <div>
              <Label>Category</Label>
              <select
                value={draft.category_id}
                onChange={(e) => setDraft((state) => ({ ...state, category_id: e.target.value }))}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                <option value="">Select category</option>
                {activeCategories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Amount</Label>
              <Input
                value={draft.amount}
                onChange={(e) => setDraft((state) => ({ ...state, amount: e.target.value }))}
                inputMode="decimal"
                className="tabular-nums"
              />
            </div>
            <div>
              <Label>Card</Label>
              <select
                value={draft.card_id}
                onChange={(e) => setDraft((state) => ({ ...state, card_id: e.target.value }))}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                <option value="none">No card</option>
                {activeCards.map((card) => (
                  <option key={card.id} value={card.id}>{card.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Start month</Label>
              <Input
                type="month"
                value={draft.start_month.slice(0, 7)}
                onChange={(e) => setDraft((state) => ({ ...state, start_month: e.target.value + "-01" }))}
              />
            </div>
            <div className="md:col-span-2">
              <Label>Note</Label>
              <Input value={draft.note} onChange={(e) => setDraft((state) => ({ ...state, note: e.target.value }))} />
            </div>
            <div>
              <Label>End month (optional)</Label>
              <Input
                type="month"
                value={draft.end_month.slice(0, 7)}
                onChange={(e) => setDraft((state) => ({ ...state, end_month: e.target.value ? e.target.value + "-01" : "" }))}
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.active}
                  onChange={(e) => setDraft((state) => ({ ...state, active: e.target.checked }))}
                />
                Active
              </label>
            </div>
            <div className="md:col-span-4">
              <Button type="submit" disabled={busy}>Add recurring item</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="text-lg font-semibold">Templates</h2>
          {templates.length === 0 && <p className="text-sm text-muted-foreground">No recurring templates yet.</p>}
          {templates.map((template) => {
            const category = categories.find((item) => item.id === template.category_id);
            const card = cards.find((item) => item.id === template.card_id);
            return (
              <div key={template.id} className="rounded-md border p-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-3">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: category?.color ?? "#6b7280" }} />
                    <span className="font-medium">{category?.name ?? "Unknown category"}</span>
                    <span className="font-semibold tabular-nums">{money(template.amount)}</span>
                    {card && <Badge variant="secondary">{card.name}</Badge>}
                    {!template.active && <Badge>paused</Badge>}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    from {template.start_month}{template.end_month ? ` to ${template.end_month}` : ""}
                  </div>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-5">
                  <Input
                    type="number"
                    step="0.01"
                    defaultValue={template.amount}
                    onBlur={(e) => run(updateTemplate(template.id, { amount: Number(e.target.value) }))}
                    className="tabular-nums"
                  />
                  <Input
                    defaultValue={template.note ?? ""}
                    onBlur={(e) => run(updateTemplate(template.id, { note: e.target.value }))}
                  />
                  <Input
                    type="month"
                    defaultValue={template.start_month.slice(0, 7)}
                    onBlur={(e) => run(updateTemplate(template.id, { start_month: e.target.value + "-01" }))}
                  />
                  <Input
                    type="month"
                    defaultValue={template.end_month?.slice(0, 7) ?? ""}
                    onBlur={(e) => run(updateTemplate(template.id, { end_month: e.target.value ? e.target.value + "-01" : "" }))}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => run(toggleActive(template.id, !template.active))}>
                      {template.active ? "Pause" : "Resume"}
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => run(deleteTemplate(template.id))}>Delete</Button>
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </>
  );
}
