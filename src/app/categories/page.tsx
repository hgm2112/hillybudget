"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { resolveHousehold } from "@/lib/household";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Category = { id: string; name: string; color: string; type: "expense" | "income"; sort_order: number; archived: boolean };
type CardItem = { id: string; name: string; color: string; sort_order: number; archived: boolean };

const PALETTE = ["#3b82f6", "#22c55e", "#f97316", "#8b5cf6", "#ef4444", "#14b8a6", "#eab308", "#ec4899", "#64748b"];

export default function CategoriesPage() {
  const router = useRouter();
  const supabase = createClient();

  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [cards, setCards] = useState<CardItem[]>([]);
  const [newCategory, setNewCategory] = useState({ name: "", color: PALETTE[0], type: "expense" as "expense" | "income" });
  const [newCard, setNewCard] = useState({ name: "", color: PALETTE[1] });
  const [showArchived, setShowArchived] = useState(false);
  const [idealWindow, setIdealWindow] = useState("trailing12");

  async function loadBase(hid: string) {
    const [{ data: categoryData }, { data: cardData }, { data: settingsData }] = await Promise.all([
      supabase.from("categories").select("*").eq("household_id", hid).order("sort_order"),
      supabase.from("cards").select("*").eq("household_id", hid).order("sort_order"),
      supabase.from("household_settings").select("*").eq("household_id", hid).maybeSingle(),
    ]);
    setCategories((categoryData ?? []) as Category[]);
    setCards((cardData ?? []) as CardItem[]);
    setIdealWindow(settingsData?.ideal_window ?? "trailing12");
  }

  useEffect(() => {
    let active = true;
    async function init() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        router.replace("/login");
        return;
      }
      const membership = await resolveHousehold(supabase, userData.user.id);
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

  const visibleCategories = useMemo(() => categories.filter((category) => showArchived || !category.archived), [categories, showArchived]);
  const visibleCards = useMemo(() => cards.filter((card) => showArchived || !card.archived), [cards, showArchived]);

  async function addCategory(event: React.FormEvent) {
    event.preventDefault();
    if (!householdId || !newCategory.name.trim()) return;
    await supabase.from("categories").insert({
      household_id: householdId,
      name: newCategory.name.trim(),
      color: newCategory.color,
      type: newCategory.type,
      sort_order: categories.length,
      archived: false,
    });
    setNewCategory({ name: "", color: PALETTE[(categories.length + 1) % PALETTE.length], type: "expense" });
    await loadBase(householdId);
  }

  async function addCard(event: React.FormEvent) {
    event.preventDefault();
    if (!householdId || !newCard.name.trim()) return;
    await supabase.from("cards").insert({
      household_id: householdId,
      name: newCard.name.trim(),
      color: newCard.color,
      sort_order: cards.length,
      archived: false,
    });
    setNewCard({ name: "", color: PALETTE[(cards.length + 1) % PALETTE.length] });
    await loadBase(householdId);
  }

  async function updateCategory(category: Category, patch: Partial<Category>) {
    await supabase.from("categories").update(patch).eq("id", category.id);
    if (householdId) await loadBase(householdId);
  }

  async function updateCard(card: CardItem, patch: Partial<CardItem>) {
    await supabase.from("cards").update(patch).eq("id", card.id);
    if (householdId) await loadBase(householdId);
  }

  async function moveCategory(category: Category, direction: -1 | 1) {
    const sorted = [...categories].sort((a, b) => a.sort_order - b.sort_order);
    const index = sorted.findIndex((item) => item.id === category.id);
    const target = sorted[index + direction];
    if (!target) return;
    await Promise.all([
      supabase.from("categories").update({ sort_order: target.sort_order }).eq("id", category.id),
      supabase.from("categories").update({ sort_order: category.sort_order }).eq("id", target.id),
    ]);
    if (householdId) await loadBase(householdId);
  }

  async function deleteCategory(category: Category) {
    const { count } = await supabase.from("entries").select("id", { count: "exact", head: true }).eq("category_id", category.id);
    if (count && count > 0) {
      await updateCategory(category, { archived: true });
      return;
    }
    await supabase.from("categories").delete().eq("id", category.id);
    if (householdId) await loadBase(householdId);
  }

  async function deleteCard(card: CardItem) {
    const { count } = await supabase.from("entries").select("id", { count: "exact", head: true }).eq("card_id", card.id);
    if (count && count > 0) {
      await updateCard(card, { archived: true });
      return;
    }
    await supabase.from("cards").delete().eq("id", card.id);
    if (householdId) await loadBase(householdId);
  }


  async function saveIdealWindow(value: string) {
    if (!householdId) return;
    await supabase.from("household_settings").update({ ideal_window: value }).eq("household_id", householdId);
    setIdealWindow(value);
  }

  if (!householdId) return <main className="p-8">Loading...</main>;

  return (
    <main className="mx-auto max-w-7xl p-4 md:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Categories and cards</h1>
        <Button variant="outline" onClick={() => setShowArchived((value) => !value)}>{showArchived ? "Hide archived" : "Show archived"}</Button>
      </div>

      <Card>
        <CardContent className="p-4">
          <h2 className="text-lg font-semibold mb-3">Categories</h2>
          <form onSubmit={addCategory} className="mb-4 grid gap-2 md:grid-cols-4">
            <Input placeholder="name" value={newCategory.name} onChange={(e) => setNewCategory((state) => ({ ...state, name: e.target.value }))} />
            <select value={newCategory.type} onChange={(e) => setNewCategory((state) => ({ ...state, type: e.target.value as "expense" | "income" }))} className="h-9 rounded-md border bg-background px-2 text-sm"><option value="expense">expense</option><option value="income">income</option></select>
            <Input type="color" value={newCategory.color} onChange={(e) => setNewCategory((state) => ({ ...state, color: e.target.value }))} />
            <Button type="submit">Add category</Button>
          </form>
          <div className="space-y-2">
            {visibleCategories.sort((a, b) => a.sort_order - b.sort_order).map((category) => (
              <div key={category.id} className="grid gap-2 md:grid-cols-[2rem_1fr_1fr_8rem_auto_auto_auto] items-center">
                <span className="h-4 w-4 rounded-full self-center" style={{ backgroundColor: category.color }} />
                <Input defaultValue={category.name} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== category.name) updateCategory(category, { name: e.target.value.trim() }); }} />
                <Input type="color" defaultValue={category.color} onBlur={(e) => updateCategory(category, { color: e.target.value })} />
                <Badge variant="secondary">{category.type}</Badge>
                <Button size="sm" variant="outline" onClick={() => moveCategory(category, -1)}>Up</Button>
                <Button size="sm" variant="outline" onClick={() => moveCategory(category, 1)}>Down</Button>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => updateCategory(category, { archived: !category.archived })}>{category.archived ? "Unarchive" : "Archive"}</Button>
                  <Button size="sm" variant="outline" onClick={() => deleteCategory(category)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h2 className="text-lg font-semibold mb-3">Cards</h2>
          <form onSubmit={addCard} className="mb-4 grid gap-2 md:grid-cols-3">
            <Input placeholder="name" value={newCard.name} onChange={(e) => setNewCard((state) => ({ ...state, name: e.target.value }))} />
            <Input type="color" value={newCard.color} onChange={(e) => setNewCard((state) => ({ ...state, color: e.target.value }))} />
            <Button type="submit">Add card</Button>
          </form>
          <div className="space-y-2">
            {visibleCards.sort((a, b) => a.sort_order - b.sort_order).map((card) => (
              <div key={card.id} className="grid gap-2 md:grid-cols-[2rem_1fr_8rem_auto_auto] items-center">
                <span className="h-4 w-4 rounded-full self-center" style={{ backgroundColor: card.color }} />
                <Input defaultValue={card.name} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== card.name) updateCard(card, { name: e.target.value.trim() }); }} />
                <Input type="color" defaultValue={card.color} onBlur={(e) => updateCard(card, { color: e.target.value })} />
                <Button size="sm" variant="outline" onClick={() => updateCard(card, { archived: !card.archived })}>{card.archived ? "Unarchive" : "Archive"}</Button>
                <Button size="sm" variant="outline" onClick={() => deleteCard(card)}>Delete</Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <h2 className="text-lg font-semibold mb-3">Ideal spending window</h2>
          <div className="flex items-center gap-3">
            <select value={idealWindow} onChange={(e) => saveIdealWindow(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
              <option value="trailing12">Trailing 12 months</option>
              <option value="trailing6">Trailing 6 months</option>
              <option value="all">All history</option>
            </select>
            <span className="text-sm text-muted-foreground">Months with zero spending are excluded from the average.</span>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
