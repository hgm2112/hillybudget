"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Category = { id: string; name: string; color: string; archived: boolean };
type CardItem = { id: string; name: string; color: string; archived: boolean };
type Template = {
  id: string;
  household_id: string;
  category_id: string;
  card_id: string | null;
  amount: number;
  note: string | null;
  start_month: string;
  end_month: string | null;
  active: boolean;
};

export default function RecurringPage() {
  const router = useRouter();
  const supabase = createClient();

  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [cards, setCards] = useState<CardItem[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [draft, setDraft] = useState(() => ({
    category_id: "",
    card_id: "none",
    amount: "",
    note: "",
    start_month: typeof window === "undefined" ? "" : new Date().toISOString().slice(0, 7) + "-01",
    end_month: "",
    active: true,
  }));

  async function loadBase(hid: string) {
    const [{ data: categoryData }, { data: cardData }, { data: templateData }] = await Promise.all([
      supabase.from("categories").select("id,name,color,archived").eq("household_id", hid).order("sort_order"),
      supabase.from("cards").select("id,name,color,archived").eq("household_id", hid).order("sort_order"),
      supabase.from("recurring_items").select("*").eq("household_id", hid).order("start_month"),
    ]);
    setCategories((categoryData ?? []) as Category[]);
    setCards((cardData ?? []) as CardItem[]);
    setTemplates(((templateData ?? []) as Template[]).map((template) => ({ ...template, amount: Number(template.amount) })));
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

  const activeCategories = useMemo(() => categories.filter((category) => !category.archived), [categories]);

  async function addTemplate(event: React.FormEvent) {
    event.preventDefault();
    if (!householdId || !draft.category_id || !draft.amount) return;
    await supabase.from("recurring_items").insert({
      household_id: householdId,
      category_id: draft.category_id,
      card_id: draft.card_id === "none" ? null : draft.card_id,
      amount: Number(draft.amount),
      note: draft.note || null,
      start_month: draft.start_month,
      end_month: draft.end_month || null,
      active: draft.active,
    });
    setDraft({ category_id: "", card_id: "none", amount: "", note: "", start_month: draft.start_month, end_month: "", active: true });
    await loadBase(householdId);
  }

  async function toggleActive(template: Template) {
    await supabase.from("recurring_items").update({ active: !template.active }).eq("id", template.id);
    if (householdId) await loadBase(householdId);
  }

  async function deleteTemplate(template: Template) {
    await supabase.from("recurring_items").delete().eq("id", template.id);
    if (householdId) await loadBase(householdId);
  }

  async function updateTemplate(template: Template, patch: Partial<Template>) {
    await supabase.from("recurring_items").update({
      amount: patch.amount ?? template.amount,
      note: patch.note ?? template.note,
      card_id: patch.card_id !== undefined ? patch.card_id : template.card_id,
      start_month: patch.start_month ?? template.start_month,
      end_month: patch.end_month !== undefined ? (patch.end_month || null) : template.end_month,
      active: patch.active ?? template.active,
    }).eq("id", template.id);
    if (householdId) await loadBase(householdId);
  }

  if (!householdId) return <main className="p-8">Loading...</main>;

  return (
    <main className="mx-auto max-w-7xl p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Recurring items</h1>
        <p className="text-sm text-muted-foreground">Fixed monthly items that generate entries on demand.</p>
      </div>

      <Card>
        <CardContent className="p-4">
          <h2 className="text-lg font-semibold mb-3">Add template</h2>
          <form onSubmit={addTemplate} className="grid gap-2 md:grid-cols-4">
            <div>
              <Label>Category</Label>
              <select value={draft.category_id} onChange={(e) => setDraft((state) => ({ ...state, category_id: e.target.value }))} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                <option value="">Select category</option>
                {activeCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Amount</Label>
              <Input value={draft.amount} onChange={(e) => setDraft((state) => ({ ...state, amount: e.target.value }))} inputMode="decimal" className="tabular-nums" />
            </div>
            <div>
              <Label>Card</Label>
              <select value={draft.card_id} onChange={(e) => setDraft((state) => ({ ...state, card_id: e.target.value }))} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                <option value="none">No card</option>
                {cards.filter((card) => !card.archived).map((card) => <option key={card.id} value={card.id}>{card.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Start month</Label>
              <Input type="month" value={draft.start_month.slice(0, 7)} onChange={(e) => setDraft((state) => ({ ...state, start_month: e.target.value + "-01" }))} />
            </div>
            <div className="md:col-span-2">
              <Label>Note</Label>
              <Input value={draft.note} onChange={(e) => setDraft((state) => ({ ...state, note: e.target.value }))} />
            </div>
            <div>
              <Label>End month (optional)</Label>
              <Input type="month" value={draft.end_month.slice(0, 7)} onChange={(e) => setDraft((state) => ({ ...state, end_month: e.target.value ? e.target.value + "-01" : "" }))} />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft((state) => ({ ...state, active: e.target.checked }))} />Active</label>
            </div>
            <div className="md:col-span-4"><Button type="submit">Add recurring item</Button></div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <h2 className="text-lg font-semibold">Templates</h2>
          {templates.length === 0 && <p className="text-sm text-muted-foreground">No recurring templates yet.</p>}
          {templates.map((template) => {
            const category = categories.find((item) => item.id === template.category_id);
            const card = cards.find((item) => item.id === template.card_id);
            return (
              <div key={template.id} className="rounded-md border p-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-3">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: category?.color ?? "#9ca3af" }} />
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
                  <Input type="number" step="0.01" defaultValue={template.amount} onBlur={(e) => updateTemplate(template, { amount: Number(e.target.value) })} className="tabular-nums" />
                  <Input defaultValue={template.note ?? ""} onBlur={(e) => updateTemplate(template, { note: e.target.value })} />
                  <Input type="month" defaultValue={template.start_month.slice(0, 7)} onBlur={(e) => updateTemplate(template, { start_month: e.target.value + "-01" })} />
                  <Input type="month" defaultValue={template.end_month?.slice(0, 7) ?? ""} onBlur={(e) => updateTemplate(template, { end_month: e.target.value ? e.target.value + "-01" : "" })} />
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => toggleActive(template)}>{template.active ? "Pause" : "Resume"}</Button>
                    <Button size="sm" variant="outline" onClick={() => deleteTemplate(template)}>Delete</Button>
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </main>
  );
}
